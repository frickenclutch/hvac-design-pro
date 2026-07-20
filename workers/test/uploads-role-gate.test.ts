/**
 * UPLOADS ROLE-GATE (F-1) — Worker integration tests.
 *
 * Regression cover for party-interlink audit finding F-1: every /api/uploads
 * endpoint was authentication-only, so a `viewer` could upload AND delete
 * files (DELETE removes the R2 object + D1 row). The fix in routes/uploads.ts
 * mirrors projects/cad exactly, via `roleSatisfies`:
 *
 *   - POST   /api/uploads      → tech+  (uploading a plan/cert is a create)
 *   - DELETE /api/uploads/:id  → admin  (destructive: drops R2 + D1)
 *   - reads (GET) stay open to any org member (org-scoped)
 *   - L0 (is_platform_admin) always passes, regardless of role
 *
 * Same real-worker + real-D1 + real-session harness as the isolation suite —
 * nothing mocked. This is a ROLE test (each role gets its own org), not a
 * tenancy test. The role gate runs BEFORE any DB lookup, so the negative
 * DELETE cases hold regardless of whether the id exists.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
  applyMigrations,
  seedTenant,
  seedOrgOwnedRows,
  callJson,
  type SeededTenant,
  type SeededOrgRows,
} from './helpers/harness';
import { generateId } from '../src/utils/id';

const db = () => (env as unknown as { DB: D1Database }).DB;

let adminU: SeededTenant;   // owns the deletable file + project
let techU: SeededTenant;
let viewerU: SeededTenant;
let l0ViewerU: SeededTenant; // role=viewer BUT is_platform_admin → always passes
let rows: SeededOrgRows;

/** A minimal but valid multipart upload body. The runtime stamps the
 *  multipart Content-Type + boundary itself (see harness `call`). */
function fileForm(projectId?: string): FormData {
  const fd = new FormData();
  fd.append('file', new File(['hello world'], 'plan.pdf', { type: 'application/pdf' }));
  fd.append('purpose', 'blueprint');
  if (projectId) fd.append('projectId', projectId);
  return fd;
}

beforeAll(async () => {
  await applyMigrations(db());

  adminU = await seedTenant(db(), {
    slug: 'ug-admin', name: 'Uploads Admin', email: 'admin@ug.test', role: 'admin',
  });
  techU = await seedTenant(db(), {
    slug: 'ug-tech', name: 'Uploads Tech', email: 'tech@ug.test', role: 'tech',
  });
  viewerU = await seedTenant(db(), {
    slug: 'ug-viewer', name: 'Uploads Viewer', email: 'viewer@ug.test', role: 'viewer',
  });
  // A viewer by role, but an L0 platform admin — the flag must beat the role.
  l0ViewerU = await seedTenant(db(), {
    slug: 'ug-l0', name: 'Uploads L0', email: 'l0@ug.test', role: 'viewer',
    isPlatformAdmin: true,
  });

  // Seed a project + file row owned by the ADMIN org so admin can delete it.
  rows = await seedOrgOwnedRows(db(), adminU.orgId, adminU.userId);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/uploads — write = tech+
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/uploads (write = tech+)', () => {
  it('viewer → 403 (blocked before the body is even parsed)', async () => {
    const { status, json } = await callJson('POST', '/api/uploads', {
      token: viewerU.token,
      formData: fileForm(),
    });
    expect(status).toBe(403);
    expect(json.error).toBe('Your role cannot upload files');
  });

  it('tech → 201 (allowed — proves the gate is not over-restricted)', async () => {
    const { status, json } = await callJson('POST', '/api/uploads', {
      token: techU.token,
      formData: fileForm(),
    });
    expect(status).toBe(201);
    expect(json.id).toBeTruthy();
    expect(json.filename).toBe('plan.pdf');
  });

  it('L0 admin whose role is viewer → 201 (platform flag beats the role)', async () => {
    const { status, json } = await callJson('POST', '/api/uploads', {
      token: l0ViewerU.token,
      formData: fileForm(),
    });
    expect(status).toBe(201);
    expect(json.id).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reads stay open to any org member (NOT role-gated).
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/uploads/project/:projectId (read = any member)', () => {
  it('viewer → 200, not 403 (listing is org-scoped, not rank-gated)', async () => {
    const { status } = await callJson(
      'GET', `/api/uploads/project/${generateId()}`, { token: viewerU.token },
    );
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/uploads/:id — delete = admin
// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/uploads/:id (delete = admin)', () => {
  it('viewer → 403', async () => {
    const { status, json } = await callJson(
      'DELETE', `/api/uploads/${generateId()}`, { token: viewerU.token },
    );
    expect(status).toBe(403);
    expect(json.error).toBe('Only admins can delete files');
  });

  it('tech → 403 (delete is admin-only, above the tech write threshold)', async () => {
    const { status, json } = await callJson(
      'DELETE', `/api/uploads/${generateId()}`, { token: techU.token },
    );
    expect(status).toBe(403);
    expect(json.error).toBe('Only admins can delete files');
  });

  // Mutates the seeded row — runs last.
  it('admin → 200 (positive control: deletes its own org file)', async () => {
    const { status, json } = await callJson(
      'DELETE', `/api/uploads/${rows.fileUploadId}`, { token: adminU.token },
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });
});
