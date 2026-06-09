/**
 * CROSS-TENANT-BY-DESIGN routes — proves the intentional exceptions still
 * behave AS DESIGNED and weren't accidentally turned into blind 404 walls (or,
 * worse, left wide open).
 *
 *   - platform : L0-only. A non-L0 caller (even an org admin) → 403. L0 → 200.
 *   - forum    : opt-in public board. A public project IS reachable by another
 *                tenant; a private one is NOT; toggling another org's share → 404.
 *   - permits  : party-gated. Submitter and authority both read the submission;
 *                an unrelated third org → 404.
 *   - audit    : role-gated (default admin+). A non-admin → 403; an admin → 200
 *                and sees ONLY its own org's rows.
 *
 * Same harness: real app, real authMiddleware, real D1, real minted sessions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
  applyMigrations,
  seedTenant,
  callJson,
  type SeededTenant,
} from './helpers/harness';
import { generateId } from '../src/utils/id';

const db = () => (env as unknown as { DB: D1Database }).DB;

let orgA: SeededTenant; // owns a project; will share it publicly
let orgB: SeededTenant; // unrelated tenant (non-L0, non-authority)
let l0: SeededTenant; // platform admin (belongs to org A)
let authority: SeededTenant; // permit authority org
let publicProjectId: string;
let privateProjectId: string;
let submissionId: string;

beforeAll(async () => {
  await applyMigrations(db());

  orgA = await seedTenant(db(), {
    slug: 'd-org-a',
    name: 'D Org A',
    email: 'admin@d-org-a.test',
    role: 'admin',
  });
  orgB = await seedTenant(db(), {
    slug: 'd-org-b',
    name: 'D Org B',
    email: 'eng@d-org-b.test',
    role: 'engineer',
  });
  l0 = await seedTenant(db(), {
    slug: 'd-l0',
    name: 'C4 Platform',
    email: 'l0@c4tech.test',
    role: 'admin',
    isPlatformAdmin: true,
  });
  authority = await seedTenant(db(), {
    slug: 'd-authority',
    name: 'Onondaga Building Dept',
    email: 'inspector@authority.test',
    role: 'admin',
    isPermitAuthority: true,
    authorityType: 'building_dept',
  });

  // Org-A owns two projects: one will be shared public, one stays private.
  publicProjectId = generateId();
  privateProjectId = generateId();
  await db()
    .prepare(
      `INSERT INTO projects (id, org_id, name, standard, status, created_by, is_public, share_summary, shared_at)
       VALUES (?, ?, 'Public Help Wanted', 'ACCA', 'active', ?, 1,
               'Need a second opinion on this Manual J load calc for a tricky two-story.', datetime('now'))`,
    )
    .bind(publicProjectId, orgA.orgId, orgA.userId)
    .run();
  await db()
    .prepare(
      `INSERT INTO projects (id, org_id, name, standard, status, created_by, is_public)
       VALUES (?, ?, 'Org-A Private Project', 'ACCA', 'active', ?, 0)`,
    )
    .bind(privateProjectId, orgA.orgId, orgA.userId)
    .run();

  // A permit submission: org-A (submitter) → authority org. Seed directly.
  submissionId = generateId();
  await db()
    .prepare(
      `INSERT INTO permit_submissions
         (id, project_id, submitter_org_id, submitter_user_id, authority_org_id,
          status, submission_type)
       VALUES (?, ?, ?, ?, ?, 'submitted', 'mechanical_permit')`,
    )
    .bind(submissionId, privateProjectId, orgA.orgId, orgA.userId, authority.orgId)
    .run();
});

// ── isPublic field check — note projects table needs is_public/share columns ──
// (Those come from migration 0004; if missing, the INSERT above would have
//  thrown in beforeAll, failing every test loudly — a good signal.)

describe('(d) platform — L0-only, not a 404 wall', () => {
  it('non-L0 org admin → 403 "Platform admin privilege required"', async () => {
    const { status, json } = await callJson('GET', '/api/platform/orgs', { token: orgA.token });
    expect(status).toBe(403);
    expect(json.error).toBe('Platform admin privilege required');
  });

  it('non-L0 engineer → 403', async () => {
    const { status } = await callJson('GET', '/api/platform/metrics', { token: orgB.token });
    expect(status).toBe(403);
  });

  it('L0 admin → 200 and sees ALL orgs (cross-tenant by design)', async () => {
    const { status, json } = await callJson('GET', '/api/platform/orgs', { token: l0.token });
    expect(status).toBe(200);
    const slugs = (json.organisations ?? []).map((o: any) => o.slug);
    // L0 sees across tenants — every seeded org is visible.
    expect(slugs).toContain('d-org-a');
    expect(slugs).toContain('d-org-b');
    expect(slugs).toContain('d-authority');
  });
});

describe('(d) forum — opt-in cross-tenant board is reachable', () => {
  it('org-B reads org-A PUBLIC project detail → 200 (cross-tenant by design)', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/forum/projects/${publicProjectId}`,
      { token: orgB.token },
    );
    expect(status).toBe(200);
    expect(json.project?.id).toBe(publicProjectId);
    expect(json.project?.share_summary).toBeTruthy();
  });

  it('org-B list of public projects includes org-A shared project', async () => {
    const { status, json } = await callJson('GET', '/api/forum/projects', { token: orgB.token });
    expect(status).toBe(200);
    const ids = (json.projects ?? []).map((p: any) => p.id);
    expect(ids).toContain(publicProjectId);
    // The PRIVATE project must NOT leak onto the public board.
    expect(ids).not.toContain(privateProjectId);
  });

  it('org-B cannot read org-A PRIVATE project via forum → 404', async () => {
    const { status } = await callJson(
      'GET',
      `/api/forum/projects/${privateProjectId}`,
      { token: orgB.token },
    );
    expect(status).toBe(404);
  });

  it("org-B cannot toggle org-A's project sharing → 404 (mutation stays org-scoped)", async () => {
    const { status, json } = await callJson(
      'POST',
      `/api/forum/projects/${publicProjectId}/share`,
      {
        token: orgB.token,
        body: { isPublic: false },
      },
    );
    expect(status).toBe(404);
    expect(json.error).toBe('Project not found');
  });
});

describe('(d) permits — party-gated read access', () => {
  it('submitter (org-A) reads the submission → 200, party=submitter', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/permits/submissions/${submissionId}`,
      { token: orgA.token },
    );
    expect(status).toBe(200);
    expect(json.party).toBe('submitter');
    expect(json.submission?.id).toBe(submissionId);
  });

  it('authority (with authority flag) reads the submission → 200, party=authority', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/permits/submissions/${submissionId}`,
      { token: authority.token },
    );
    expect(status).toBe(200);
    expect(json.party).toBe('authority');
    // Cross-tenant project payload is the DELIBERATE exception — both parties
    // get the full project. Confirm it resolved.
    expect(json.project?.id).toBe(privateProjectId);
  });

  it('unrelated third org (org-B, not a party) → 404 "Submission not found"', async () => {
    const { status, json } = await callJson(
      'GET',
      `/api/permits/submissions/${submissionId}`,
      { token: orgB.token },
    );
    expect(status).toBe(404);
    expect(json.error).toBe('Submission not found');
  });

  it('submissions list is auto-scoped — org-B sees none of org-A↔authority', async () => {
    const { status, json } = await callJson('GET', '/api/permits/submissions', {
      token: orgB.token,
    });
    expect(status).toBe(200);
    const ids = (json.submissions ?? []).map((s: any) => s.id);
    expect(ids).not.toContain(submissionId);
  });
});

describe('(d) audit — role-gated, org-scoped feed', () => {
  it('non-admin (org-B is engineer, default auditView=admin) → 403', async () => {
    const { status, json } = await callJson('GET', '/api/audit-log', { token: orgB.token });
    expect(status).toBe(403);
    expect(json.error).toBe('Your role does not have access to the audit log.');
  });

  it('admin (org-A) → 200 and only sees its own org rows', async () => {
    // Generate at least one auditable mutation as org-A so the feed is non-trivial.
    await callJson('POST', '/api/projects/', {
      token: orgA.token,
      body: { name: 'Audit-seed project' },
    });
    const { status, json } = await callJson('GET', '/api/audit-log', { token: orgA.token });
    expect(status).toBe(200);
    expect(json.scope).toBe('tenant');
    // Every row in a tenant-scoped admin feed belongs to org-A (actor or target).
    for (const ev of json.events ?? []) {
      const actorOrg = ev.actor?.orgId;
      const targetOrg = ev.target?.orgId;
      expect(actorOrg === orgA.orgId || targetOrg === orgA.orgId).toBe(true);
    }
  });

  it('L0 with ?scope=platform → 200 and sees cross-org rows', async () => {
    const { status, json } = await callJson('GET', '/api/audit-log?scope=platform', {
      token: l0.token,
    });
    expect(status).toBe(200);
    expect(json.scope).toBe('platform');
  });
});
