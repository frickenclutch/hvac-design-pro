import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';
import { roleSatisfies } from '../utils/accessPolicy';

// LiDAR / field-capture scan records (migration 0022, spec
// docs/LIDAR_FIELD_CAPTURE_SPEC_2026-08-05.md Phase 1).
//
// This route owns its R2 writes + scan_captures rows instead of riding
// /api/uploads: widening the file_uploads purpose CHECK would take a D1 table
// rebuild on a hot table (the 0018 cascade trap), and a scan is not a plain
// attachment — it has a review lifecycle (uploaded → parsed → confirmed /
// discarded) that IS the record. Payloads are opaque blobs here by design:
// all parsing is client-side pure TS (engines/roomScan.ts), so the Worker
// carries no JSON/USDZ processing surface.

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export const scanRoutes = new Hono<{ Bindings: Env }>();

// MUST stay in sync with the scan_captures.source CHECK (migrations/0022).
// Validated up front so a bad value 400s BEFORE the R2 put (uploads.ts idiom —
// a CHECK-violation 500 after the put would orphan the object).
const SCAN_SOURCES = new Set(['roomplan_json', 'usdz', 'app_bundle', 'e57', 'ply']);
const EXT_BY_SOURCE: Record<string, string> = {
  roomplan_json: 'json',
  usdz: 'usdz',
  app_bundle: 'zip',
  e57: 'e57',
  ply: 'ply',
};
// JSON + USDZ tier. Point-cloud sources are accepted under the same cap for
// now — the plan-tiered caps (spec §9 / D-7) land with the Phase-3 registry.
const MAX_SCAN_BYTES = 25 * 1024 * 1024;
const MAX_SUMMARY_BYTES = 16 * 1024;

// Upload a capture payload + create its record.
scanRoutes.post('/', async (c) => {
  const user = c.get('user');
  // §5 matrix: field capture is a create action — tech+, same gate as uploads.
  // (L0 always passes via roleSatisfies.)
  if (!roleSatisfies(user.role, 'tech', user.isPlatformAdmin)) {
    return c.json({ error: 'Your role cannot upload scans' }, 403);
  }
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File;
  const projectId = formData.get('projectId') as string | null;
  const source = (formData.get('source') as string) || 'roomplan_json';
  const parsedSummary = formData.get('parsedSummary') as string | null;
  const engineVersion = formData.get('engineVersion') as string | null;
  const headingRaw = formData.get('headingDeg') as string | null;
  const capturedAt = formData.get('capturedAt') as string | null;

  if (!file) return c.json({ error: 'No file provided' }, 400);
  // Scans are project-scoped data, full stop — draft-mode captures stay
  // local-only on the client and never reach this endpoint.
  if (!projectId) return c.json({ error: 'projectId is required' }, 400);
  if (!SCAN_SOURCES.has(source)) {
    return c.json({ error: `Invalid source '${source}'` }, 400);
  }
  if (file.size > MAX_SCAN_BYTES) {
    return c.json({ error: `Scan exceeds the ${Math.round(MAX_SCAN_BYTES / 1024 / 1024)} MB limit` }, 413);
  }
  if (parsedSummary && parsedSummary.length > MAX_SUMMARY_BYTES) {
    return c.json({ error: 'parsedSummary too large' }, 400);
  }
  if (engineVersion && engineVersion.length > 64) {
    return c.json({ error: 'engineVersion too long' }, 400);
  }
  if (capturedAt && capturedAt.length > 40) {
    return c.json({ error: 'capturedAt too long' }, 400);
  }
  let headingDeg: number | null = null;
  if (headingRaw !== null && headingRaw !== '') {
    const h = Number(headingRaw);
    if (!Number.isFinite(h) || h < -360 || h > 360) {
      return c.json({ error: 'headingDeg must be a number in [-360, 360]' }, 400);
    }
    headingDeg = h;
  }

  // D1 doesn't enforce FKs — verify the project against the SESSION org here,
  // or a forged projectId would hang another tenant's id on this org's row.
  const project = await c.env.DB.prepare(
    'SELECT id FROM projects WHERE id = ? AND org_id = ?'
  ).bind(projectId, user.orgId).first();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const id = generateId();
  const r2Key = `${user.orgId}/${projectId}/scans/${id}.${EXT_BY_SOURCE[source]}`;

  await c.env.STORAGE.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { uploadedBy: user.id, originalName: file.name, purpose: 'lidar_scan' },
  });

  // A client that already parsed the capture uploads summary + engine stamp in
  // the same request, so the row is born 'parsed' — one round trip, no window
  // where a parsed scan looks unparsed.
  const status = parsedSummary ? 'parsed' : 'uploaded';

  // R2 and D1 aren't one transaction: if the insert fails, delete the object
  // we just wrote or it leaks as an unreferenced blob (uploads.ts idiom).
  try {
    await c.env.DB.prepare(
      `INSERT INTO scan_captures (id, org_id, project_id, source, r2_key, filename, size_bytes, parsed_summary, engine_version, status, heading_deg, captured_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, user.orgId, projectId, source, r2Key, file.name, file.size,
      parsedSummary, engineVersion, status, headingDeg, capturedAt, user.id,
    ).run();
  } catch (e) {
    await c.env.STORAGE.delete(r2Key).catch(() => { /* best-effort cleanup */ });
    throw e;
  }

  setAudit(c, {
    action: 'scan.upload',
    entityType: 'scan_capture',
    entityId: id,
    entityLabel: file.name,
    projectId,
    detail: { source, sizeBytes: file.size, status, engineVersion: engineVersion || undefined },
  });

  return c.json({ id, projectId, source, status, filename: file.name, sizeBytes: file.size }, 201);
});

// List a project's captures (review history / library).
scanRoutes.get('/project/:projectId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const { results } = await c.env.DB.prepare(
    `SELECT id, source, status, filename, size_bytes, parsed_summary, engine_version, heading_deg, captured_at, created_by, created_at
     FROM scan_captures WHERE project_id = ? AND org_id = ? ORDER BY created_at DESC`
  ).bind(projectId, user.orgId).all();
  return c.json({ scans: results });
});

// Advance a capture's status. Rows only move forward: uploaded/parsed →
// confirmed | discarded. Confirmed means an engineer applied the geometry to
// the drawing — a design-level mutation, so engineer+; discarding your own
// bad scan is field workflow, tech+.
scanRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string }>().catch(() => null);
  const next = body?.status;
  if (next !== 'confirmed' && next !== 'discarded') {
    return c.json({ error: "status must be 'confirmed' or 'discarded'" }, 400);
  }
  const required = next === 'confirmed' ? 'engineer' : 'tech';
  if (!roleSatisfies(user.role, required, user.isPlatformAdmin)) {
    return c.json({ error: `Your role cannot mark a scan ${next}` }, 403);
  }

  const record = await c.env.DB.prepare(
    'SELECT id, status, filename, project_id FROM scan_captures WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();
  if (!record) return c.json({ error: 'Not found' }, 404);
  const current = record.status as string;
  if (current !== 'uploaded' && current !== 'parsed') {
    return c.json({ error: `Scan is already ${current}` }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE scan_captures SET status = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?`
  ).bind(next, id, user.orgId).run();

  setAudit(c, {
    action: next === 'confirmed' ? 'scan.confirm' : 'scan.discard',
    entityType: 'scan_capture',
    entityId: id,
    entityLabel: (record.filename as string) ?? id,
    projectId: (record.project_id as string) ?? undefined,
    beforeValue: { status: current },
    afterValue: { status: next },
  });

  return c.json({ id, status: next });
});
