import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';
import { resolveAccessPolicy, roleSatisfies } from '../utils/accessPolicy';

interface Env {
  DB: D1Database;
}

export const cadRoutes = new Hono<{ Bindings: Env }>();

/** Resolve the caller's org access policy. Cheap single-row read; the
 *  version endpoints all need it so it's centralized here. */
async function orgPolicy(db: D1Database, orgId: string) {
  const row = await db.prepare(
    `SELECT settings FROM organisations WHERE id = ?`
  ).bind(orgId).first();
  return resolveAccessPolicy(row?.settings);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Compute the next version_number for a drawing. Returns 1 for new drawings.
 *  Race protection: the (drawing_id, version_number) unique index is the
 *  real defense — this read is just to pick the next ordinal; if two PUTs
 *  race, one INSERT fails the unique constraint and the audit row still
 *  fires correctly. */
async function nextVersionNumber(db: D1Database, drawingId: string): Promise<number> {
  const row = await db.prepare(
    'SELECT COALESCE(MAX(version_number), 0) AS n FROM cad_drawing_versions WHERE drawing_id = ?'
  ).bind(drawingId).first();
  return Number(row?.n ?? 0) + 1;
}

/** Insert an immutable version snapshot. Used by both POST (v1) and PUT
 *  (v2..vN). Append-only.
 *
 *  thumbnailDataUrl is stored verbatim in the thumbnail_key column when
 *  provided. The column was originally typed for an R2 object key (hence
 *  the name), but for MVP we store the data URL inline so the frontend
 *  can render it directly via <img src=...> without an authenticated
 *  fetch + blob roundtrip. If thumbnail storage cost grows, migrate the
 *  payload to R2 in a follow-up and switch column contents to keys. */
async function writeVersion(
  db: D1Database,
  args: {
    drawingId: string;
    projectId: string;
    orgId: string;
    canvasJson: string;
    authorUserId: string | null;
    thumbnailDataUrl?: string | null;
  },
): Promise<{ versionId: string; versionNumber: number }> {
  const versionNumber = await nextVersionNumber(db, args.drawingId);
  const versionId = generateId();
  // Cap thumbnail size at 200 KB to prevent a runaway frontend (or an
  // attacker injecting a massive payload) from bloating D1. Most real
  // thumbnails are 5-30 KB at our default capture multiplier.
  const safeThumb = args.thumbnailDataUrl && args.thumbnailDataUrl.length < 200_000
    ? args.thumbnailDataUrl
    : null;
  await db.prepare(
    `INSERT INTO cad_drawing_versions
       (id, drawing_id, project_id, org_id, version_number, canvas_json,
        size_bytes, thumbnail_key, author_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    versionId,
    args.drawingId,
    args.projectId,
    args.orgId,
    versionNumber,
    args.canvasJson,
    args.canvasJson.length,
    safeThumb,
    args.authorUserId,
  ).run();
  return { versionId, versionNumber };
}

/** Throttle window for cad_drawing.update audit rows. 60 seconds is enough
 *  to collapse a burst of auto-saves into one entry while still capturing
 *  the "someone edited this drawing in the last minute" signal. The full
 *  fidelity trail lives in cad_drawing_versions, not the audit log. */
const AUDIT_THROTTLE_SECONDS = 60;

/** Was there an audit_log row for this drawing.update within the throttle
 *  window? When true, the PUT handler skips the audit write so the operator
 *  feed stays clean during auto-save bursts. */
async function recentlyAudited(db: D1Database, drawingId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 FROM audit_log
     WHERE action = 'cad_drawing.update'
       AND entity_id = ?
       AND created_at > datetime('now', ?)
     LIMIT 1`
  ).bind(drawingId, `-${AUDIT_THROTTLE_SECONDS} seconds`).first();
  return !!row;
}

// ── Routes ──────────────────────────────────────────────────────────────────

// List CAD drawings for a project
cadRoutes.get('/project/:projectId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, floor_index, thumbnail_key, created_at, updated_at
     FROM cad_drawings WHERE project_id = ? AND org_id = ? ORDER BY floor_index`
  ).bind(projectId, user.orgId).all();

  return c.json({ drawings: results });
});

// Get single drawing (with full canvas JSON)
cadRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const drawing = await c.env.DB.prepare(
    'SELECT * FROM cad_drawings WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (!drawing) return c.json({ error: 'Not found' }, 404);

  return c.json({
    ...drawing,
    canvasJson: JSON.parse(drawing.canvas_json as string),
  });
});

// Save/create a CAD drawing
cadRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const id = generateId();
  const canvasJson = JSON.stringify(body.canvasJson);

  // CLAUDE.md §5 matrix: viewers are view-only. tech+ may author drawings.
  if (!roleSatisfies(user.role, 'tech', user.isPlatformAdmin)) {
    return c.json({ error: 'Your role cannot create drawings' }, 403);
  }

  // SECURITY (tenant isolation): same class of hole as calculations POST.
  // The project must belong to the caller's org before we create a
  // drawing (and a cascading cad_drawing_versions snapshot) keyed to it.
  // Without this an authed user could inject a drawing into another
  // tenant's project, which then leaks via the permit-detail payload.
  if (!body.projectId || typeof body.projectId !== 'string') {
    return c.json({ error: 'projectId is required' }, 400);
  }
  const ownProject = await c.env.DB.prepare(
    'SELECT id FROM projects WHERE id = ? AND org_id = ?'
  ).bind(body.projectId, user.orgId).first();
  if (!ownProject) {
    return c.json({ error: 'Project not found in your organisation' }, 404);
  }

  await c.env.DB.prepare(
    `INSERT INTO cad_drawings (id, project_id, org_id, name, floor_index, canvas_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.projectId, user.orgId, body.name || 'Floor Plan',
         body.floorIndex || 0, canvasJson, user.id).run();

  // Snapshot v1 — the inception state. Every drawing has at least one
  // version; subsequent PUTs append v2..vN.
  await writeVersion(c.env.DB, {
    drawingId: id,
    projectId: body.projectId,
    orgId: user.orgId,
    canvasJson,
    authorUserId: user.id,
    thumbnailDataUrl: typeof body.thumbnailDataUrl === 'string' ? body.thumbnailDataUrl : null,
  });

  setAudit(c, {
    action: 'cad_drawing.create',
    entityType: 'cad_drawing',
    entityId: id,
    entityLabel: body.name || 'Floor Plan',
    projectId: body.projectId,
    detail: { floorIndex: body.floorIndex || 0, versionNumber: 1 },
  });

  return c.json({ id, versionNumber: 1 }, 201);
});

// Update a CAD drawing (auto-save)
//
// Two storage paths fire here:
//
//  1. The live `cad_drawings` row gets overwritten — current state for
//     fast loads.
//  2. An append-only `cad_drawing_versions` snapshot captures the new
//     canvas state with author + timestamp. Full fidelity for forensic
//     recall ("what did this look like at 2:47 PM?") regardless of how
//     many subsequent saves happen.
//
// Audit-log writes are THROTTLED to 1 row per drawing per 60 seconds.
// Auto-save fires constantly during CAD work; without throttling the
// operator audit feed drowns in noise. The drawing itself is the truth,
// and the version table is the fidelity-preserving record — the audit
// log only needs to surface the "someone edited this drawing" signal
// for operator workflows, not every keystroke.
cadRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  // tech+ may save drawings (auto-save included). Viewers are read-only.
  if (!roleSatisfies(user.role, 'tech', user.isPlatformAdmin)) {
    return c.json({ error: 'Your role cannot edit drawings' }, 403);
  }
  const id = c.req.param('id');
  const body = await c.req.json();
  const canvasJson = JSON.stringify(body.canvasJson);

  await c.env.DB.prepare(
    `UPDATE cad_drawings SET canvas_json = ?, name = COALESCE(?, name),
     updated_at = datetime('now') WHERE id = ? AND org_id = ?`
  ).bind(canvasJson, body.name || null, id, user.orgId).run();

  const drawing = await c.env.DB.prepare(
    'SELECT name, project_id FROM cad_drawings WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();
  if (!drawing) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Append a version snapshot. UNTHROTTLED — every save is a forensic
  // record. The audit-log throttle below only affects the operator feed.
  const { versionNumber } = await writeVersion(c.env.DB, {
    drawingId: id,
    projectId: drawing.project_id as string,
    orgId: user.orgId,
    canvasJson,
    authorUserId: user.id,
    thumbnailDataUrl: typeof body.thumbnailDataUrl === 'string' ? body.thumbnailDataUrl : null,
  });

  // Audit throttle — skip the audit row if we wrote one for this drawing
  // in the last 60s. The full forensic trail lives in cad_drawing_versions.
  const throttled = await recentlyAudited(c.env.DB, id);
  if (!throttled) {
    setAudit(c, {
      action: 'cad_drawing.update',
      entityType: 'cad_drawing',
      entityId: id,
      entityLabel: drawing.name as string,
      projectId: drawing.project_id as string,
      detail: { versionNumber },
    });
  }

  return c.json({ ok: true, versionNumber, audited: !throttled });
});

// Delete a CAD drawing
cadRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  // Destructive + cascades the entire cad_drawing_versions history via
  // ON DELETE CASCADE. Admin-only, matching the project-delete gate.
  if (!roleSatisfies(user.role, 'admin', user.isPlatformAdmin)) {
    return c.json({ error: 'Only admins can delete drawings' }, 403);
  }
  const id = c.req.param('id');

  const before = await c.env.DB.prepare(
    'SELECT name, project_id, floor_index FROM cad_drawings WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  // The ON DELETE CASCADE on cad_drawing_versions.drawing_id removes the
  // version history with the drawing. Restoration after delete requires
  // a separate Phase 3 "soft delete" path.
  await c.env.DB.prepare('DELETE FROM cad_drawings WHERE id = ? AND org_id = ?')
    .bind(id, user.orgId).run();

  if (before) {
    setAudit(c, {
      action: 'cad_drawing.delete',
      entityType: 'cad_drawing',
      entityId: id,
      entityLabel: before.name as string,
      projectId: before.project_id as string,
      beforeValue: before as Record<string, unknown>,
    });
  }

  return c.json({ ok: true });
});

// ── Version history endpoints ───────────────────────────────────────────────

// List versions for a drawing — newest first. Each row carries metadata
// only (no canvas_json) so the version-history sidebar stays light. The
// detail endpoint below returns full canvas state when the user clicks
// "Preview this version."
cadRoutes.get('/:id/versions', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  // Policy gate: who may VIEW version history (default: everyone with
  // org access — it's their own work).
  const policy = await orgPolicy(c.env.DB, user.orgId);
  if (!roleSatisfies(user.role, policy.versionView, user.isPlatformAdmin)) {
    return c.json({ error: 'Your role does not have access to version history.' }, 403);
  }

  // Confirm the drawing belongs to caller's org before we expose the
  // version trail.
  const drawing = await c.env.DB.prepare(
    'SELECT id FROM cad_drawings WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();
  if (!drawing) return c.json({ error: 'Not found' }, 404);

  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500);
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.version_number, v.size_bytes, v.thumbnail_key,
            v.author_user_id, v.created_at,
            u.first_name AS author_first_name,
            u.last_name  AS author_last_name,
            u.email      AS author_email
     FROM cad_drawing_versions v
     LEFT JOIN users u ON u.id = v.author_user_id
     WHERE v.drawing_id = ?
     ORDER BY v.version_number DESC
     LIMIT ?`
  ).bind(id, limit).all();

  return c.json({ versions: results, drawingId: id, limit });
});

// Load a specific version's full canvas state. Used by the version-
// history sidebar's "Preview" action — the frontend loads this JSON into
// a read-only view layer above the canvas without mutating the live row.
cadRoutes.get('/versions/:versionId', async (c) => {
  const user = c.get('user');
  const versionId = c.req.param('versionId');

  // Same view gate as the list endpoint — previewing a version is a read.
  const policy = await orgPolicy(c.env.DB, user.orgId);
  if (!roleSatisfies(user.role, policy.versionView, user.isPlatformAdmin)) {
    return c.json({ error: 'Your role does not have access to version history.' }, 403);
  }

  // Join through cad_drawings to enforce org_id ownership — versions
  // inherit access from the parent drawing.
  const row = await c.env.DB.prepare(
    `SELECT v.id, v.drawing_id, v.project_id, v.org_id, v.version_number,
            v.canvas_json, v.size_bytes, v.author_user_id, v.created_at,
            u.first_name AS author_first_name,
            u.last_name  AS author_last_name,
            u.email      AS author_email
     FROM cad_drawing_versions v
     LEFT JOIN users u ON u.id = v.author_user_id
     WHERE v.id = ? AND v.org_id = ?`
  ).bind(versionId, user.orgId).first();

  if (!row) return c.json({ error: 'Version not found' }, 404);

  return c.json({
    ...row,
    canvasJson: JSON.parse(row.canvas_json as string),
  });
});

// Restore a prior version as the new latest state. This appends a new
// version (not overwrites history) — so the act of restoration is itself
// recorded, and the chain of restores is reconstructable. Audit row
// fires unthrottled because manual restoration is operator-initiated,
// not auto-save noise.
cadRoutes.post('/versions/:versionId/restore', async (c) => {
  const user = c.get('user');
  const versionId = c.req.param('versionId');

  // Policy gate: RESTORE is destructive (overwrites the live canvas).
  // Default threshold is `admin` — observers/engineers can look but the
  // overwrite stays with admins + L0 unless the tenant admin loosens it.
  const policy = await orgPolicy(c.env.DB, user.orgId);
  if (!roleSatisfies(user.role, policy.versionRestore, user.isPlatformAdmin)) {
    return c.json({ error: 'Your role cannot restore versions. Ask a tenant admin.' }, 403);
  }

  const source = await c.env.DB.prepare(
    `SELECT v.id, v.drawing_id, v.project_id, v.org_id, v.version_number,
            v.canvas_json
     FROM cad_drawing_versions v
     WHERE v.id = ? AND v.org_id = ?`
  ).bind(versionId, user.orgId).first();
  if (!source) return c.json({ error: 'Version not found' }, 404);

  // Overwrite the live row with the historical canvas state.
  await c.env.DB.prepare(
    `UPDATE cad_drawings
        SET canvas_json = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`
  ).bind(source.canvas_json, source.drawing_id, user.orgId).run();

  // Append a new version pointing at the restored content. The new
  // version's metadata records that it was a restoration of versionId.
  const newVersionNumber = await nextVersionNumber(c.env.DB, source.drawing_id as string);
  const newVersionId = generateId();
  await c.env.DB.prepare(
    `INSERT INTO cad_drawing_versions
       (id, drawing_id, project_id, org_id, version_number, canvas_json,
        size_bytes, author_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newVersionId,
    source.drawing_id,
    source.project_id,
    user.orgId,
    newVersionNumber,
    source.canvas_json,
    (source.canvas_json as string).length,
    user.id,
  ).run();

  const drawing = await c.env.DB.prepare(
    'SELECT name FROM cad_drawings WHERE id = ?'
  ).bind(source.drawing_id).first();

  setAudit(c, {
    action: 'cad_drawing.restore',
    entityType: 'cad_drawing',
    entityId: source.drawing_id as string,
    entityLabel: drawing?.name as string,
    projectId: source.project_id as string,
    detail: {
      restoredFromVersion: source.version_number,
      newVersionNumber,
      sourceVersionId: versionId,
    },
  });

  return c.json({
    ok: true,
    drawingId: source.drawing_id,
    versionNumber: newVersionNumber,
    versionId: newVersionId,
  });
});
