/**
 * CROSS-TENANT ISOLATION — Worker integration tests.
 *
 * Proves the half the static tenant-scoping guard cannot: that the org_id
 * clause is CORRECT (bound from the session-derived org), not just present.
 * Every test dispatches a REAL Request through the REAL Hono app and the REAL
 * authMiddleware against a REAL Miniflare D1 seeded with the production
 * migrations 0001-0011. Sessions are minted via the production mintTokenPair()
 * (SHA-256 hashed at rest). Nothing is mocked.
 *
 * Org-A owns the data. Org-B is a separate tenant with a separate session.
 * The contract: org-B must get 404 (not 403, not data) on each of org-A's
 * strict-table rows BY ID, and org-A must still read them (negative control).
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

const db = () => (env as unknown as { DB: D1Database }).DB;

let orgA: SeededTenant;
let orgB: SeededTenant;
let rows: SeededOrgRows;

beforeAll(async () => {
  await applyMigrations(db());

  // Org A — owns the data. Admin so it can read its own rows + hit version
  // endpoints whose default policy (versionView=viewer) it trivially clears.
  orgA = await seedTenant(db(), {
    slug: 'org-a',
    name: 'Organization A',
    email: 'admin@org-a.test',
    role: 'admin',
  });

  // Org B — a separate tenant. Admin too, to PROVE that even a high-privilege
  // user in another org is walled off: the 404 is tenancy, not role.
  orgB = await seedTenant(db(), {
    slug: 'org-b',
    name: 'Organization B',
    email: 'admin@org-b.test',
    role: 'admin',
  });

  rows = await seedOrgOwnedRows(db(), orgA.orgId, orgA.userId);
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Org-A reads its OWN rows — success + correct shape.
// ─────────────────────────────────────────────────────────────────────────────
describe('(a) Org-A reads its own strict-table rows', () => {
  it('GET /api/projects/:id → 200 with the project', async () => {
    const { status, json } = await callJson('GET', `/api/projects/${rows.projectId}`, {
      token: orgA.token,
    });
    expect(status).toBe(200);
    expect(json.project?.id).toBe(rows.projectId);
    expect(json.project?.org_id).toBe(orgA.orgId);
  });

  it('GET /api/projects → list includes the org-A project', async () => {
    // No trailing slash — the canonical form lib/api.ts uses. Hono's mounted
    // `sub.get('/')` matches `/api/projects`, not `/api/projects/`.
    const { status, json } = await callJson('GET', '/api/projects', { token: orgA.token });
    expect(status).toBe(200);
    const ids = (json.projects ?? []).map((p: any) => p.id);
    expect(ids).toContain(rows.projectId);
  });

  it('GET /api/calculations/:id → 200 with parsed outputs', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/calculations/${rows.calculationId}`,
      { token: orgA.token },
    );
    expect(status).toBe(200);
    expect(json.id).toBe(rows.calculationId);
    expect(json.outputs?.heatBtuh).toBe(42000);
  });

  it('GET /api/calculations/project/:projectId → includes the calc', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/calculations/project/${rows.projectId}`,
      { token: orgA.token },
    );
    expect(status).toBe(200);
    const ids = (json.calculations ?? []).map((c: any) => c.id);
    expect(ids).toContain(rows.calculationId);
  });

  it('GET /api/cad/:id → 200 with canvasJson', async () => {
    const { status, json } = await callJson('GET', `/api/cad/${rows.cadDrawingId}`, {
      token: orgA.token,
    });
    expect(status).toBe(200);
    expect(json.id).toBe(rows.cadDrawingId);
    expect(json.canvasJson).toBeTruthy();
  });

  it('GET /api/cad/:id/versions → lists the seeded version', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/cad/${rows.cadDrawingId}/versions`,
      { token: orgA.token },
    );
    expect(status).toBe(200);
    const ids = (json.versions ?? []).map((v: any) => v.id);
    expect(ids).toContain(rows.cadVersionId);
  });

  it('GET /api/cad/versions/:versionId → 200 with the version', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/cad/versions/${rows.cadVersionId}`,
      { token: orgA.token },
    );
    expect(status).toBe(200);
    expect(json.id).toBe(rows.cadVersionId);
  });

  it('GET /api/uploads/project/:projectId → includes the file', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/uploads/project/${rows.projectId}`,
      { token: orgA.token },
    );
    expect(status).toBe(200);
    const ids = (json.files ?? []).map((f: any) => f.id);
    expect(ids).toContain(rows.fileUploadId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Org-B is 404'd on each of org-A's strict-table rows BY ID — never 403,
//     never data. And org-B's LIST endpoints never include an org-A row.
// ─────────────────────────────────────────────────────────────────────────────
describe('(b) Org-B is walled off from org-A strict-table rows', () => {
  it('GET /api/projects/:id (org-A id) → 404, not 403, not data', async () => {
    const { status, json } = await callJson('GET', `/api/projects/${rows.projectId}`, {
      token: orgB.token,
    });
    expect(status).toBe(404);
    expect(json.error).toBe('Not found');
    expect(json.project).toBeUndefined();
  });

  it('GET /api/projects (org-B) → list excludes the org-A project', async () => {
    const { status, json } = await callJson('GET', '/api/projects', { token: orgB.token });
    expect(status).toBe(200);
    const ids = (json.projects ?? []).map((p: any) => p.id);
    expect(ids).not.toContain(rows.projectId);
    expect(json.projects).toHaveLength(0);
  });

  it('GET /api/calculations/:id (org-A id) → 404, no outputs leaked', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/calculations/${rows.calculationId}`,
      { token: orgB.token },
    );
    expect(status).toBe(404);
    expect(json.error).toBe('Not found');
    expect(json.outputs).toBeUndefined();
  });

  it('GET /api/calculations/project/:projectId (org-A project) → empty, no leak', async () => {
    // The query is scoped by org_id too, so org-B sees an empty list for a
    // project it does not own — never org-A's calc rows.
    const { status, json } = await callJson(
      'GET',
      `/api/calculations/project/${rows.projectId}`,
      { token: orgB.token },
    );
    expect(status).toBe(200);
    const ids = (json.calculations ?? []).map((c: any) => c.id);
    expect(ids).not.toContain(rows.calculationId);
    expect(json.calculations).toHaveLength(0);
  });

  it('POST /api/calculations targeting org-A project → 404 "not found in your organisation"', async () => {
    // The cross-tenant INJECTION vector: an authed org-B user POSTs a calc
    // keyed to org-A's project. The handler's ownership pre-check must reject
    // it (the org_id stamp alone is insufficient — a row with org_id=B but
    // project_id=A would leak to org-A via the permit-detail calc query).
    const { status, json } = await callJson('POST', '/api/calculations', {
      token: orgB.token,
      body: {
        projectId: rows.projectId,
        calcType: 'MANUAL_J',
        inputs: { x: 1 },
        outputs: { y: 2 },
        engineVersion: 'manualJ8-ts-1.1.0',
      },
    });
    expect(status).toBe(404);
    expect(json.error).toBe('Project not found in your organisation');
  });

  it('no org-B calc row was injected into org-A project (DB-level check)', async () => {
    // Belt-and-suspenders: confirm the injection attempt left zero calc rows
    // on org-A's project. Reads D1 directly — not through a scoped handler.
    const row = await db()
      .prepare('SELECT COUNT(*) AS n FROM calculations WHERE project_id = ?')
      .bind(rows.projectId)
      .first();
    // Exactly the one calc we seeded for org-A — no org-B injection landed.
    expect(Number(row?.n ?? 0)).toBe(1);
  });

  it('GET /api/cad/:id (org-A drawing) → 404, no canvas leaked', async () => {
    const { status, json } = await callJson('GET', `/api/cad/${rows.cadDrawingId}`, {
      token: orgB.token,
    });
    expect(status).toBe(404);
    expect(json.error).toBe('Not found');
    expect(json.canvasJson).toBeUndefined();
  });

  it('GET /api/cad/project/:projectId (org-A project) → empty, no leak', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/cad/project/${rows.projectId}`,
      { token: orgB.token },
    );
    expect(status).toBe(200);
    const ids = (json.drawings ?? []).map((d: any) => d.id);
    expect(ids).not.toContain(rows.cadDrawingId);
    expect(json.drawings).toHaveLength(0);
  });

  it('GET /api/cad/:id/versions (org-A drawing) → 404', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/cad/${rows.cadDrawingId}/versions`,
      { token: orgB.token },
    );
    expect(status).toBe(404);
    expect(json.error).toBe('Not found');
  });

  it('GET /api/cad/versions/:versionId (org-A version) → 404, no canvas leaked', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/cad/versions/${rows.cadVersionId}`,
      { token: orgB.token },
    );
    expect(status).toBe(404);
    expect(json.canvasJson).toBeUndefined();
  });

  it('POST /api/cad targeting org-A project → 404 "not found in your organisation"', async () => {
    const { status, json } = await callJson('POST', '/api/cad', {
      token: orgB.token,
      body: {
        projectId: rows.projectId,
        name: 'Injected',
        canvasJson: { objects: [] },
      },
    });
    expect(status).toBe(404);
    expect(json.error).toBe('Project not found in your organisation');
  });

  it('GET /api/uploads/:id (org-A file) → 404, no record leaked', async () => {
    const { status, json } = await callJson('GET', `/api/uploads/${rows.fileUploadId}`, {
      token: orgB.token,
    });
    expect(status).toBe(404);
    expect(json.error).toBe('Not found');
    expect(json.r2_key).toBeUndefined();
    expect(json.filename).toBeUndefined();
  });

  it('GET /api/uploads/project/:projectId (org-A project) → empty, no leak', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/uploads/project/${rows.projectId}`,
      { token: orgB.token },
    );
    expect(status).toBe(200);
    const ids = (json.files ?? []).map((f: any) => f.id);
    expect(ids).not.toContain(rows.fileUploadId);
    expect(json.files).toHaveLength(0);
  });

  it("DELETE /api/projects/:id (org-A project) → org-B's delete is a no-op; the row SURVIVES", async () => {
    // Org-B is an ADMIN, so the role gate (admin-only delete) passes — the
    // ONLY thing protecting org-A's project from destruction is the
    // `AND org_id = ?` scope on the DELETE. The endpoint is idempotent: it
    // returns 200 {ok:true} even when zero rows match (org mismatch), so the
    // status alone is NOT the isolation signal — SURVIVAL is. A leaky scope
    // here would silently destroy another firm's permit data.
    const del = await callJson('DELETE', `/api/projects/${rows.projectId}`, {
      token: orgB.token,
    });
    expect(del.status).toBe(200);
    expect(del.json.ok).toBe(true);

    // DB-level proof the row is intact AND still owned by org-A.
    const survivor = await db()
      .prepare('SELECT id, org_id FROM projects WHERE id = ?')
      .bind(rows.projectId)
      .first<{ id: string; org_id: string }>();
    expect(survivor).toBeTruthy();
    expect(survivor?.org_id).toBe(orgA.orgId);

    // And org-A can still read it through the API.
    const read = await callJson('GET', `/api/projects/${rows.projectId}`, {
      token: orgA.token,
    });
    expect(read.status).toBe(200);
    expect(read.json.project?.id).toBe(rows.projectId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) NEGATIVE CONTROL — proves the 404 above is TENANT SCOPING, not a bad
//     token / wrong id. Org-A reads the SAME ids org-B was 404'd on, with a
//     200. If scoping were removed, (b) would start returning 200s; if the
//     ids/tokens were simply invalid, (c) would fail with 404. Both halves
//     passing == the wall is real and load-bearing.
// ─────────────────────────────────────────────────────────────────────────────
describe('(c) Negative control — org-A reads the very ids org-B is 404\'d on', () => {
  it('org-A: project / calc / cad / version / file all readable by the same ids', async () => {
    const project = await callJson('GET', `/api/projects/${rows.projectId}`, { token: orgA.token });
    expect(project.status).toBe(200);
    expect(project.json.project?.id).toBe(rows.projectId);

    const calc = await callJson('GET', `/api/calculations/${rows.calculationId}`, { token: orgA.token });
    expect(calc.status).toBe(200);
    expect(calc.json.id).toBe(rows.calculationId);

    const cad = await callJson('GET', `/api/cad/${rows.cadDrawingId}`, { token: orgA.token });
    expect(cad.status).toBe(200);
    expect(cad.json.id).toBe(rows.cadDrawingId);

    const version = await callJson('GET', `/api/cad/versions/${rows.cadVersionId}`, { token: orgA.token });
    expect(version.status).toBe(200);
    expect(version.json.id).toBe(rows.cadVersionId);

    const file = await callJson('GET', `/api/uploads/${rows.fileUploadId}`, { token: orgA.token });
    // file_uploads GET streams from R2; the D1 row resolves (200) but the R2
    // object was never put (we seeded D1 directly), so the handler returns
    // 404 "File not found in storage" AFTER passing the org_id ownership
    // check. Either way org-A is NOT walled out at the tenancy layer — assert
    // the response is NOT the tenancy 404 ("Not found") org-B got.
    if (file.status === 404) {
      expect(file.json.error).toBe('File not found in storage');
    } else {
      expect(file.status).toBe(200);
    }
  });

  it('control: an INVALID token is rejected with 401 (distinguishes 404-scope from 401-auth)', async () => {
    const { status } = await callJson('GET', `/api/projects/${rows.projectId}`, {
      token: 'totally-invalid-token',
    });
    expect(status).toBe(401);
  });

  it('control: a NONEXISTENT id (org-A token) is also 404 — same code path, different cause', async () => {
    const { status } = await callJson('GET', '/api/projects/does-not-exist-anywhere', {
      token: orgA.token,
    });
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) BILLING / USAGE tables (migration 0012) are tenant-isolated. Same
//     contract as (b)+(c): org-B is 404'd / sees no org-A billing data; org-A
//     reads its own rows (negative control). Plus a proof that the per-usage
//     gate DEFAULT-ALLOWS when no entitlement is configured (non-breaking).
// ─────────────────────────────────────────────────────────────────────────────
describe('(d) Billing/usage tables are tenant-isolated', () => {
  // Org-B is walled off from org-A's billing rows.
  it('GET /api/billing/usage/:id (org-A event) → 404, no data leaked', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/billing/usage/${rows.usageEventId}`,
      { token: orgB.token },
    );
    expect(status).toBe(404);
    expect(json.event).toBeUndefined();
  });

  it('GET /api/billing/subscription → org-B never sees org-A subscription', async () => {
    const { status, json } = await callJson('GET', '/api/billing/subscription', {
      token: orgB.token,
    });
    expect(status).toBe(200);
    expect(json.subscription).toBeNull(); // org-B has none; org-A's is invisible
  });

  it('GET /api/billing/invoices → org-B list excludes org-A invoice', async () => {
    const { status, json } = await callJson('GET', '/api/billing/invoices', {
      token: orgB.token,
    });
    expect(status).toBe(200);
    const ids = (json.invoices ?? []).map((i: any) => i.id);
    expect(ids).not.toContain(rows.invoiceId);
    expect(json.invoices).toHaveLength(0);
  });

  it('GET /api/billing/payment-methods → org-B excludes org-A method', async () => {
    const { status, json } = await callJson('GET', '/api/billing/payment-methods', {
      token: orgB.token,
    });
    expect(status).toBe(200);
    const ids = (json.paymentMethods ?? []).map((m: any) => m.id);
    expect(ids).not.toContain(rows.paymentMethodId);
    expect(json.paymentMethods).toHaveLength(0);
  });

  // Negative control: org-A reads its OWN rows (proves the 404 is tenancy, not
  // a broken route).
  it('org-A reads its own usage event', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/billing/usage/${rows.usageEventId}`,
      { token: orgA.token },
    );
    expect(status).toBe(200);
    expect(json.event?.id).toBe(rows.usageEventId);
    expect(json.event?.org_id).toBe(orgA.orgId);
  });

  it('org-A sees its own subscription + invoice + payment method', async () => {
    const sub = await callJson('GET', '/api/billing/subscription', { token: orgA.token });
    expect(sub.status).toBe(200);
    expect(sub.json.subscription?.id).toBe(rows.subscriptionId);

    const inv = await callJson('GET', '/api/billing/invoices', { token: orgA.token });
    expect(inv.json.invoices.map((i: any) => i.id)).toContain(rows.invoiceId);

    const pm = await callJson('GET', '/api/billing/payment-methods', { token: orgA.token });
    expect(pm.json.paymentMethods.map((m: any) => m.id)).toContain(rows.paymentMethodId);
  });

  // Non-breaking gating: a meter with NO entitlement row is ungated (allowed,
  // not gated). This is the guarantee that wiring the meter into existing flows
  // later won't break production until a limit is explicitly configured.
  it('checkEntitlement default-allows when no entitlement configured', async () => {
    const { status, json } = await callJson(
      'GET',
      '/api/billing/usage?meter=calc_run',
      { token: orgA.token },
    );
    expect(status).toBe(200);
    expect(json.entitlement.allowed).toBe(true);
    expect(json.entitlement.gated).toBe(false);
  });
});
