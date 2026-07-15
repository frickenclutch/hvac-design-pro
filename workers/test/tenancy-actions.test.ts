/**
 * TENANCY ACTIONS — Worker integration tests for the three final Action-lab
 * units (migration 0017) + the session-expiry comparison fix:
 *
 *   (a) Session expiry regression — ISO expires_at vs datetime('now') string
 *       comparison silently extended every expiry to UTC midnight. A token
 *       expired SECONDS ago must now 401.
 *   (b) Impersonate org — L0 mints a read-only, access-only session scoped
 *       to a target tenant; every mutation under it is blocked; exit kills
 *       only that session.
 *   (c) Reparent user — consent-based transfer of a solo-org user into a
 *       requesting tenant; nothing moves without the target's accept.
 *   (d) Subdivision tree — child orgs under a tenant; single-level;
 *       first-member-must-be-admin; only empty children removable.
 *
 * Same contract as the isolation suite: REAL requests through the REAL Hono
 * app + authMiddleware against a REAL Miniflare D1. Nothing mocked.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
  applyMigrations,
  seedTenant,
  callJson,
  type SeededTenant,
} from './helpers/harness';
import { mintTokenPair } from '../src/utils/session';
import { generateId } from '../src/utils/id';
import { hashToken } from '../src/utils/crypto';

const db = () => (env as unknown as { DB: D1Database }).DB;

/** Add an extra user to an EXISTING org (seedTenant always creates a new
 *  org). Mints a real session for them. */
async function seedUserInOrg(
  orgId: string,
  email: string,
  role: 'admin' | 'engineer' | 'tech' | 'viewer',
): Promise<{ userId: string; token: string }> {
  const userId = generateId();
  await db().prepare(
    `INSERT INTO users
       (id, org_id, email, password_hash, role, first_name, last_name,
        is_verified, is_platform_admin, is_permit_authority, status)
     VALUES (?, ?, ?, 'x:y', ?, 'Extra', 'User', 1, 0, 0, 'active')`,
  ).bind(userId, orgId, email, role).run();
  const { accessToken } = await mintTokenPair(db(), userId, orgId);
  return { userId, token: accessToken };
}

let l0: SeededTenant;        // platform admin (own org)
let orgA: SeededTenant;      // main tenant — runs reparent + subdivisions
let orgT: SeededTenant;      // impersonation target
let soloB: SeededTenant;     // fragmented user — accepts a transfer
let soloE: SeededTenant;     // fragmented user — declines a transfer
let authorityD: SeededTenant; // solo user whose org is a permit authority
let orgC: SeededTenant;      // multi-member org (not fragmented)
let orgCSecond: { userId: string; token: string };

beforeAll(async () => {
  await applyMigrations(db());
  l0 = await seedTenant(db(), {
    slug: 'l0-org', name: 'C4 Platform', email: 'l0@platform.test',
    role: 'admin', isPlatformAdmin: true,
  });
  orgA = await seedTenant(db(), {
    slug: 'org-a', name: 'Org A Mechanical', email: 'admin@org-a.test', role: 'admin',
  });
  orgT = await seedTenant(db(), {
    slug: 'org-t', name: 'Target Tenant', email: 'admin@org-t.test', role: 'admin',
  });
  soloB = await seedTenant(db(), {
    slug: 'solo-b', name: "B's Workspace", email: 'solo-b@fragmented.test', role: 'admin',
  });
  soloE = await seedTenant(db(), {
    slug: 'solo-e', name: "E's Workspace", email: 'solo-e@fragmented.test', role: 'admin',
  });
  authorityD = await seedTenant(db(), {
    slug: 'authority-d', name: 'Inspector D', email: 'solo-d@authority.test',
    role: 'admin', authorityType: 'building_dept',
  });
  orgC = await seedTenant(db(), {
    slug: 'org-c', name: 'Org C Multi', email: 'admin@org-c.test', role: 'admin',
  });
  orgCSecond = await seedUserInOrg(orgC.orgId, 'second@org-c.test', 'tech');
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Session expiry regression — same-day-expired tokens must die NOW.
// ─────────────────────────────────────────────────────────────────────────────
describe('(a) session expiry comparison fix', () => {
  it('a token that expired seconds ago (same UTC day, ISO format) → 401', async () => {
    const raw = `expired-${generateId()}`;
    await db().prepare(
      `INSERT INTO sessions (id, user_id, org_id, token, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      generateId(), orgA.userId, orgA.orgId, await hashToken(raw),
      new Date(Date.now() - 1000).toISOString(),
    ).run();

    const viaMiddleware = await callJson('GET', '/api/org', { token: raw });
    expect(viaMiddleware.status).toBe(401);
    const viaMe = await callJson('GET', '/api/auth/me', { token: raw });
    expect(viaMe.status).toBe(401);
  });

  it('a live token still authenticates (negative control)', async () => {
    const { status } = await callJson('GET', '/api/org', { token: orgA.token });
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Impersonate org
// ─────────────────────────────────────────────────────────────────────────────
describe('(b) L0 org impersonation', () => {
  let impToken: string;

  it('non-L0 admin cannot impersonate → 403', async () => {
    const { status } = await callJson(
      'POST', `/api/platform/orgs/${orgT.orgId}/impersonate`, { token: orgA.token },
    );
    expect(status).toBe(403);
  });

  it('unknown org → 404; own org → 400', async () => {
    const unknown = await callJson(
      'POST', '/api/platform/orgs/nope/impersonate', { token: l0.token },
    );
    expect(unknown.status).toBe(404);
    const own = await callJson(
      'POST', `/api/platform/orgs/${l0.orgId}/impersonate`, { token: l0.token },
    );
    expect(own.status).toBe(400);
  });

  it('L0 impersonates target org → 200 with access-only token', async () => {
    const { status, json } = await callJson(
      'POST', `/api/platform/orgs/${orgT.orgId}/impersonate`, { token: l0.token },
    );
    expect(status).toBe(200);
    expect(json.token).toBeTruthy();
    expect(json.organisation?.id).toBe(orgT.orgId);
    impToken = json.token;

    // Access-only: no refresh token row was written for it.
    const refreshRows = await db().prepare(
      `SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(l0.userId).first();
    // Only the L0's own login pair from seedTenant exists.
    expect(Number(refreshRows?.n)).toBe(1);
  });

  it('impersonation session sees the TARGET org context', async () => {
    const me = await callJson('GET', '/api/auth/me', { token: impToken });
    expect(me.status).toBe(200);
    expect(me.json.organisation?.id).toBe(orgT.orgId);
    expect(me.json.impersonating).toBe(true);
    expect(me.json.user?.id).toBe(l0.userId); // identity stays the L0 admin

    const org = await callJson('GET', '/api/org', { token: impToken });
    expect(org.status).toBe(200);
    expect(org.json.organisation?.id).toBe(orgT.orgId);
  });

  it('every mutation under impersonation → 403 read-only', async () => {
    const orgEdit = await callJson('PUT', '/api/org', {
      token: impToken, body: { name: 'Hijacked' },
    });
    expect(orgEdit.status).toBe(403);

    const invite = await callJson('POST', '/api/org/invite', {
      token: impToken, body: { email: 'x@y.test', role: 'tech' },
    });
    expect(invite.status).toBe(403);

    // No chaining — impersonate from an impersonation session is a mutation.
    const chain = await callJson(
      'POST', `/api/platform/orgs/${orgA.orgId}/impersonate`, { token: impToken },
    );
    expect(chain.status).toBe(403);

    // Target org unharmed.
    const org = await db().prepare(
      `SELECT name FROM organisations WHERE id = ?`,
    ).bind(orgT.orgId).first();
    expect(org?.name).toBe('Target Tenant');
  });

  it('impersonation start is audited with target_org_id', async () => {
    const row = await db().prepare(
      `SELECT target_org_id, is_platform_action FROM audit_log
       WHERE action = 'platform.org.impersonate' ORDER BY created_at DESC LIMIT 1`,
    ).first();
    expect(row?.target_org_id).toBe(orgT.orgId);
    expect(Number(row?.is_platform_action)).toBe(1);
  });

  it('exit with a NORMAL session → 400; exit with impersonation token kills only it', async () => {
    const wrong = await callJson('POST', '/api/platform/impersonation/exit', { token: l0.token });
    expect(wrong.status).toBe(400);

    const exit = await callJson('POST', '/api/platform/impersonation/exit', { token: impToken });
    expect(exit.status).toBe(200);

    // Impersonation token is dead...
    const dead = await callJson('GET', '/api/org', { token: impToken });
    expect(dead.status).toBe(401);
    // ...but the L0's real session survives.
    const alive = await callJson('GET', '/api/platform/me', { token: l0.token });
    expect(alive.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Reparent user
// ─────────────────────────────────────────────────────────────────────────────
describe('(c) reparent — consent-based account transfer', () => {
  let transferId: string;

  it('request validation: unknown email → 404, own member → 409, multi-member org → 409, non-admin → 403', async () => {
    const unknown = await callJson('POST', '/api/org/reparent', {
      token: orgA.token, body: { email: 'ghost@nowhere.test' },
    });
    expect(unknown.status).toBe(404);

    const ownMember = await callJson('POST', '/api/org/reparent', {
      token: orgA.token, body: { email: orgA.email },
    });
    expect(ownMember.status).toBe(409);

    const multiMember = await callJson('POST', '/api/org/reparent', {
      token: orgA.token, body: { email: 'second@org-c.test' },
    });
    expect(multiMember.status).toBe(409);

    const nonAdmin = await callJson('POST', '/api/org/reparent', {
      token: orgCSecond.token, body: { email: soloB.email },
    });
    expect(nonAdmin.status).toBe(403);
  });

  it('admin requests transfer of a solo user → 201; duplicate → 409', async () => {
    const { status, json } = await callJson('POST', '/api/org/reparent', {
      token: orgA.token, body: { email: soloB.email, role: 'engineer' },
    });
    expect(status).toBe(201);
    transferId = json.id;

    const dup = await callJson('POST', '/api/org/reparent', {
      token: orgA.token, body: { email: soloB.email, role: 'tech' },
    });
    expect(dup.status).toBe(409);
  });

  it('reparent tokens are NOT redeemable as signup invites', async () => {
    const inviteRow = await db().prepare(
      `SELECT token FROM org_invites WHERE id = ?`,
    ).bind(transferId).first();
    const rawToken = inviteRow?.token as string;

    const preview = await callJson('GET', `/api/auth/invite/${rawToken}`);
    expect(preview.status).toBe(409);
    expect(preview.json.alreadyRegistered).toBe(true);

    const redeem = await callJson('POST', `/api/auth/invite/${rawToken}/redeem`, {
      body: { firstName: 'Evil', lastName: 'Twin', password: 'password123' },
    });
    expect(redeem.status).toBe(409);
  });

  it('only the addressed user sees / can act on the transfer', async () => {
    const mine = await callJson('GET', '/api/auth/transfers', { token: soloB.token });
    expect(mine.status).toBe(200);
    expect(mine.json.transfers).toHaveLength(1);
    expect(mine.json.transfers[0].id).toBe(transferId);
    expect(mine.json.transfers[0].org_name).toBe('Org A Mechanical');

    const notMine = await callJson('GET', '/api/auth/transfers', { token: soloE.token });
    expect(notMine.json.transfers).toHaveLength(0);

    const stealAccept = await callJson(
      'POST', `/api/auth/transfers/${transferId}/accept`, { token: soloE.token },
    );
    expect(stealAccept.status).toBe(404); // existence not leaked
  });

  it('accept moves the account, kills old sessions, returns a fresh pair for the new org', async () => {
    const { status, json } = await callJson(
      'POST', `/api/auth/transfers/${transferId}/accept`, { token: soloB.token },
    );
    expect(status).toBe(200);
    expect(json.token).toBeTruthy();
    expect(json.refreshToken).toBeTruthy();
    expect(json.organisation?.id).toBe(orgA.orgId);
    expect(json.user?.role).toBe('engineer'); // the invited role

    // Old token is dead (sessions purged on org switch).
    const oldDead = await callJson('GET', '/api/org', { token: soloB.token });
    expect(oldDead.status).toBe(401);

    // New token authenticates into org A.
    const me = await callJson('GET', '/api/auth/me', { token: json.token });
    expect(me.status).toBe(200);
    expect(me.json.organisation?.id).toBe(orgA.orgId);

    // users.org_id actually moved; the old org is empty but intact.
    const moved = await db().prepare(
      `SELECT org_id, role FROM users WHERE id = ?`,
    ).bind(soloB.userId).first();
    expect(moved?.org_id).toBe(orgA.orgId);
    const oldOrg = await db().prepare(
      `SELECT id FROM organisations WHERE id = ?`,
    ).bind(soloB.orgId).first();
    expect(oldOrg?.id).toBe(soloB.orgId);

    // Replay of the consumed transfer → 410 (no longer pending).
    const replay = await callJson(
      'POST', `/api/auth/transfers/${transferId}/accept`, { token: json.token },
    );
    expect(replay.status).toBe(410);
  });

  it('decline marks the request revoked and it disappears from the list', async () => {
    const req = await callJson('POST', '/api/org/reparent', {
      token: orgA.token, body: { email: soloE.email, role: 'tech' },
    });
    expect(req.status).toBe(201);

    const decline = await callJson(
      'POST', `/api/auth/transfers/${req.json.id}/decline`, { token: soloE.token },
    );
    expect(decline.status).toBe(200);

    const list = await callJson('GET', '/api/auth/transfers', { token: soloE.token });
    expect(list.json.transfers).toHaveLength(0);

    const row = await db().prepare(
      `SELECT status FROM org_invites WHERE id = ?`,
    ).bind(req.json.id).first();
    expect(row?.status).toBe('revoked');
  });

  it('accept is blocked when the old org is a configured permit authority', async () => {
    const req = await callJson('POST', '/api/org/reparent', {
      token: orgA.token, body: { email: authorityD.email, role: 'tech' },
    });
    expect(req.status).toBe(201);

    const accept = await callJson(
      'POST', `/api/auth/transfers/${req.json.id}/accept`, { token: authorityD.token },
    );
    expect(accept.status).toBe(409);
    // User did NOT move.
    const still = await db().prepare(
      `SELECT org_id FROM users WHERE id = ?`,
    ).bind(authorityD.userId).first();
    expect(still?.org_id).toBe(authorityD.orgId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Subdivision tree
// ─────────────────────────────────────────────────────────────────────────────
describe('(d) subdivisions — child orgs', () => {
  let branchId: string;

  it('non-admin cannot create → 403; admin creates → 201', async () => {
    const tech = await seedUserInOrg(orgA.orgId, 'tech@org-a.test', 'tech');
    const denied = await callJson('POST', '/api/org/subdivisions', {
      token: tech.token, body: { name: 'Nope Branch' },
    });
    expect(denied.status).toBe(403);

    const { status, json } = await callJson('POST', '/api/org/subdivisions', {
      token: orgA.token, body: { name: 'Potsdam Branch' },
    });
    expect(status).toBe(201);
    branchId = json.subdivision.id;

    const list = await callJson('GET', '/api/org/subdivisions', { token: orgA.token });
    expect(list.status).toBe(200);
    expect(list.json.subdivisions).toHaveLength(1);
    expect(list.json.subdivisions[0].user_count).toBe(0);
    expect(list.json.parent).toBeNull();
  });

  it('a subdivision cannot parent its own subdivisions (single level)', async () => {
    const childAdmin = await seedUserInOrg(branchId, 'admin@branch.test', 'admin');
    const nested = await callJson('POST', '/api/org/subdivisions', {
      token: childAdmin.token, body: { name: 'Sub-sub' },
    });
    expect(nested.status).toBe(400);

    // The child's own /subdivisions view surfaces the parent breadcrumb.
    const view = await callJson('GET', '/api/org/subdivisions', { token: childAdmin.token });
    expect(view.json.parent?.id).toBe(orgA.orgId);
  });

  it('invite into a subdivision: first member must be admin; foreign child → 404', async () => {
    // Fresh empty child for the first-member rule (branchId already got a
    // directly-seeded admin above).
    const fresh = await callJson('POST', '/api/org/subdivisions', {
      token: orgA.token, body: { name: 'Canton Branch' },
    });
    const freshId = fresh.json.subdivision.id;

    const techFirst = await callJson('POST', '/api/org/invite', {
      token: orgA.token, body: { email: 'first@canton.test', role: 'tech', subdivisionId: freshId },
    });
    expect(techFirst.status).toBe(400);

    const adminFirst = await callJson('POST', '/api/org/invite', {
      token: orgA.token, body: { email: 'first@canton.test', role: 'admin', subdivisionId: freshId },
    });
    expect(adminFirst.status).toBe(201);

    // Redeem lands the user in the CHILD org.
    const redeem = await callJson('POST', `/api/auth/invite/${adminFirst.json.token}/redeem`, {
      body: { firstName: 'First', lastName: 'Member', password: 'password123' },
    });
    expect(redeem.status).toBe(200);
    expect(redeem.json.organisation?.id).toBe(freshId);

    const list = await callJson('GET', '/api/org/subdivisions', { token: orgA.token });
    const canton = list.json.subdivisions.find((s: { id: string }) => s.id === freshId);
    expect(canton.user_count).toBe(1);

    // Another tenant's admin cannot target org A's child.
    const foreign = await callJson('POST', '/api/org/invite', {
      token: orgT.token, body: { email: 'x@foreign.test', role: 'admin', subdivisionId: freshId },
    });
    expect(foreign.status).toBe(404);
  });

  it('only EMPTY subdivisions can be removed', async () => {
    // branchId has a member → 409.
    const denied = await callJson('DELETE', `/api/org/subdivisions/${branchId}`, {
      token: orgA.token,
    });
    expect(denied.status).toBe(409);

    const empty = await callJson('POST', '/api/org/subdivisions', {
      token: orgA.token, body: { name: 'Ephemeral Branch' },
    });
    const removed = await callJson('DELETE', `/api/org/subdivisions/${empty.json.subdivision.id}`, {
      token: orgA.token,
    });
    expect(removed.status).toBe(200);

    const list = await callJson('GET', '/api/org/subdivisions', { token: orgA.token });
    const ids = list.json.subdivisions.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(empty.json.subdivision.id);
  });
});
