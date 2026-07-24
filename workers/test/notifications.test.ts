/**
 * NOTIFICATIONS — server-side emission + inbox isolation.
 *
 * Two things are proven here, both against a REAL Miniflare D1 seeded with the
 * production migrations and dispatched through the REAL Hono app:
 *
 *  1. THE DELIVERY GATE IS REAL. Org policy (forced_on/forced_off/user_choice)
 *     combined with the member's preference decides whether a row is written AT
 *     ALL. This used to be resolved in the browser, where it was advisory —
 *     anything that bypassed the store wrote whatever it liked. Now it is
 *     enforced at the only place that can enforce it, and these tests are what
 *     say so.
 *
 *  2. AN INBOX IS PRIVATE. Every route is scoped to `org_id = session.orgId AND
 *     user_id = session.id`. Org-B must not see, read, or dismiss org-A's
 *     notifications even knowing the exact id — and a member must not see a
 *     colleague's inbox inside their OWN org, which is a stricter bar than the
 *     usual tenant test and the one an inbox actually needs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, seedTenant, callJson, type SeededTenant } from './helpers/harness';
import { notifyUser, notifyOrg } from '../src/utils/notifications';

const db = () => (env as unknown as { DB: D1Database }).DB;

let orgA: SeededTenant;      // admin in org A
let orgAPeer: SeededTenant;  // a second member of org A (seeded separately)
let orgB: SeededTenant;      // a different tenant entirely

beforeAll(async () => {
  await applyMigrations(db());

  orgA = await seedTenant(db(), {
    slug: 'notif-org-a', name: 'Notif Org A', email: 'admin@notif-a.test', role: 'admin',
  });
  orgB = await seedTenant(db(), {
    slug: 'notif-org-b', name: 'Notif Org B', email: 'admin@notif-b.test', role: 'admin',
  });

  // A second member INSIDE org A. seedTenant always makes a new org, so this
  // one is created by hand and then re-homed into org A.
  orgAPeer = await seedTenant(db(), {
    slug: 'notif-org-a-peer', name: 'Notif Org A Peer', email: 'peer@notif-a.test', role: 'engineer',
  });
  await db().prepare(`UPDATE users SET org_id = ? WHERE id = ?`)
    .bind(orgA.orgId, orgAPeer.userId).run();
  await db().prepare(`UPDATE sessions SET org_id = ? WHERE user_id = ?`)
    .bind(orgA.orgId, orgAPeer.userId).run();
  orgAPeer.orgId = orgA.orgId;
});

/** Set an org's notification policy directly in organisations.settings. */
async function setPolicy(orgId: string, policy: Record<string, string>): Promise<void> {
  await db().prepare(`UPDATE organisations SET settings = ? WHERE id = ?`)
    .bind(JSON.stringify({ notificationPolicy: policy }), orgId).run();
}

/** Clear an org's settings back to neutral (all user_choice). `settings` is
 *  NOT NULL, so this writes an empty object rather than NULL. */
async function resetPolicy(orgId: string): Promise<void> {
  await db().prepare(`UPDATE organisations SET settings = '{}' WHERE id = ?`).bind(orgId).run();
}

async function setPrefs(userId: string, prefs: Record<string, boolean>): Promise<void> {
  await db().prepare(`UPDATE users SET notification_prefs = ? WHERE id = ?`)
    .bind(JSON.stringify(prefs), userId).run();
}

async function countFor(userId: string): Promise<number> {
  const row = await db().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?`)
    .bind(userId).first();
  return Number(row?.n ?? 0);
}

async function wipe(): Promise<void> {
  await db().prepare(`DELETE FROM notifications`).run();
}

// ── The delivery gate ────────────────────────────────────────────────────────

describe('emission — the delivery gate', () => {
  beforeAll(async () => { await wipe(); });

  it('writes a row for a user_choice kind the member left on', async () => {
    await resetPolicy(orgA.orgId);
    await setPrefs(orgA.userId, { calc: true, permit: true, team: true, community: true, security: true, system: true });

    const result = await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'permit', title: 'Permit approved',
    });

    expect(result).toBe('delivered');
    expect(await countFor(orgA.userId)).toBe(1);
  });

  it('suppresses a kind the member opted out of', async () => {
    await wipe();
    await resetPolicy(orgA.orgId);
    await setPrefs(orgA.userId, { calc: false, permit: true, team: true, community: true, security: true, system: true });

    const result = await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'calc', title: 'Calc finished',
    });

    expect(result).toBe('suppressed');
    expect(await countFor(orgA.userId)).toBe(0);
  });

  it('forced_on overrides the member opting out — the admin ultimately decides', async () => {
    await wipe();
    await setPolicy(orgA.orgId, { security: 'forced_on' });
    await setPrefs(orgA.userId, { calc: true, permit: true, team: true, community: true, security: false, system: true });

    const result = await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'security', title: 'Your role changed',
    });

    expect(result).toBe('delivered');
    expect(await countFor(orgA.userId)).toBe(1);
  });

  it('forced_off suppresses even when the member wants it', async () => {
    await wipe();
    await setPolicy(orgA.orgId, { community: 'forced_off' });
    await setPrefs(orgA.userId, { calc: true, permit: true, team: true, community: true, security: true, system: true });

    const result = await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'community', title: 'New reply',
    });

    expect(result).toBe('suppressed');
    expect(await countFor(orgA.userId)).toBe(0);
  });

  it('distinguishes a suppressed member from a missing one — the two must not be conflated', async () => {
    await wipe();
    await resetPolicy(orgA.orgId);

    // Deactivated recipient → no_recipient (a caller MAY escalate elsewhere).
    await db().prepare(`UPDATE users SET status = 'deactivated' WHERE id = ?`)
      .bind(orgAPeer.userId).run();
    const gone = await notifyUser(db(), orgAPeer.userId, {
      orgId: orgA.orgId, kind: 'permit', title: 'Permit approved',
    });
    await db().prepare(`UPDATE users SET status = 'active' WHERE id = ?`)
      .bind(orgAPeer.userId).run();

    // Opted-out recipient → suppressed (a caller MUST NOT escalate).
    await setPrefs(orgAPeer.userId, { calc: true, permit: false, team: true, community: true, security: true, system: true });
    const muted = await notifyUser(db(), orgAPeer.userId, {
      orgId: orgA.orgId, kind: 'permit', title: 'Permit approved',
    });

    expect(gone).toBe('no_recipient');
    expect(muted).toBe('suppressed');
    expect(gone).not.toBe(muted);
  });

  it('refuses to address a recipient in a different org', async () => {
    await wipe();
    await resetPolicy(orgA.orgId);
    await setPrefs(orgB.userId, { calc: true, permit: true, team: true, community: true, security: true, system: true });

    // A mismatched (orgId, userId) pair — the shape a confused or malicious
    // caller would produce. The emitter re-verifies membership before writing.
    const result = await notifyUser(db(), orgB.userId, {
      orgId: orgA.orgId, kind: 'permit', title: 'Should never land',
    });

    expect(result).toBe('no_recipient');
    expect(await countFor(orgB.userId)).toBe(0);
  });

  it('stores only relative hrefs — an absolute URL is dropped, not persisted', async () => {
    await wipe();
    await resetPolicy(orgA.orgId);
    await setPrefs(orgA.userId, { calc: true, permit: true, team: true, community: true, security: true, system: true });

    await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'system', title: 'Absolute', href: 'https://evil.example/steal',
    });
    await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'system', title: 'Protocol-relative', href: '//evil.example/steal',
    });
    await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'system', title: 'Relative', href: '/permits',
    });

    const { results } = await db().prepare(
      `SELECT title, href FROM notifications WHERE user_id = ? ORDER BY title`
    ).bind(orgA.userId).all();

    const byTitle = Object.fromEntries((results ?? []).map((r) => [r.title as string, r.href]));
    expect(byTitle['Absolute']).toBeNull();
    expect(byTitle['Protocol-relative']).toBeNull();
    expect(byTitle['Relative']).toBe('/permits');
  });

  it('fan-out reaches every active member and respects each one’s preference', async () => {
    await wipe();
    await resetPolicy(orgA.orgId);
    await setPrefs(orgA.userId, { calc: true, permit: true, team: true, community: true, security: true, system: true });
    await setPrefs(orgAPeer.userId, { calc: true, permit: true, team: false, community: true, security: true, system: true });

    const written = await notifyOrg(db(), {
      orgId: orgA.orgId, kind: 'team', title: 'Someone joined',
    });

    expect(written).toBe(1);                        // peer opted out of `team`
    expect(await countFor(orgA.userId)).toBe(1);
    expect(await countFor(orgAPeer.userId)).toBe(0);
  });

  it('fan-out honours excludeUserId so an actor is not told about their own action', async () => {
    await wipe();
    await resetPolicy(orgA.orgId);
    await setPrefs(orgAPeer.userId, { calc: true, permit: true, team: true, community: true, security: true, system: true });

    const written = await notifyOrg(
      db(),
      { orgId: orgA.orgId, kind: 'team', title: 'Someone joined' },
      { excludeUserId: orgA.userId },
    );

    expect(written).toBe(1);
    expect(await countFor(orgA.userId)).toBe(0);
    expect(await countFor(orgAPeer.userId)).toBe(1);
  });
});

// ── The inbox routes ─────────────────────────────────────────────────────────

describe('inbox — privacy and read-state', () => {
  let targetId: string;

  beforeAll(async () => {
    await wipe();
    await resetPolicy(orgA.orgId);
    await resetPolicy(orgB.orgId);
    for (const u of [orgA, orgAPeer, orgB]) {
      await setPrefs(u.userId, {
        calc: true, permit: true, team: true, community: true, security: true, system: true,
      });
    }
    await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'permit', title: 'Org-A private notification', href: '/permits',
    });
    const row = await db().prepare(
      `SELECT id FROM notifications WHERE user_id = ?`
    ).bind(orgA.userId).first();
    targetId = row!.id as string;
  });

  it('the recipient reads their own inbox with an accurate unread count', async () => {
    const { status, json } = await callJson('GET', '/api/notifications', { token: orgA.token });
    expect(status).toBe(200);
    expect(json.notifications).toHaveLength(1);
    expect(json.notifications[0].title).toBe('Org-A private notification');
    expect(json.notifications[0].read).toBe(false);
    expect(json.unread).toBe(1);
  });

  it('another tenant sees nothing and cannot dismiss by id', async () => {
    const list = await callJson('GET', '/api/notifications', { token: orgB.token });
    expect(list.json.notifications).toHaveLength(0);

    const del = await callJson('DELETE', `/api/notifications/${targetId}`, { token: orgB.token });
    expect(del.status).toBe(404);

    // Still there, still unread — the 404 was a refusal, not a silent success.
    const after = await callJson('GET', '/api/notifications', { token: orgA.token });
    expect(after.json.notifications).toHaveLength(1);
    expect(after.json.unread).toBe(1);
  });

  it('a colleague in the SAME org cannot read or dismiss another member’s notification', async () => {
    const list = await callJson('GET', '/api/notifications', { token: orgAPeer.token });
    expect(list.json.notifications).toHaveLength(0);

    const del = await callJson('DELETE', `/api/notifications/${targetId}`, { token: orgAPeer.token });
    expect(del.status).toBe(404);
  });

  it('marks read by id, then clears the badge with all:true', async () => {
    const read = await callJson('POST', '/api/notifications/read', {
      token: orgA.token, body: { ids: [targetId] },
    });
    expect(read.status).toBe(200);
    expect(read.json.updated).toBe(1);

    const after = await callJson('GET', '/api/notifications', { token: orgA.token });
    expect(after.json.notifications[0].read).toBe(true);
    expect(after.json.unread).toBe(0);

    // A second unread row, cleared via all:true.
    await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'system', title: 'Another one',
    });
    const all = await callJson('POST', '/api/notifications/read', {
      token: orgA.token, body: { all: true },
    });
    expect(all.json.updated).toBe(1);
    const cleared = await callJson('GET', '/api/notifications', { token: orgA.token });
    expect(cleared.json.unread).toBe(0);
  });

  it('rejects a read request with neither ids nor all', async () => {
    const { status } = await callJson('POST', '/api/notifications/read', {
      token: orgA.token, body: {},
    });
    expect(status).toBe(400);
  });

  it('requires a session', async () => {
    const { status } = await callJson('GET', '/api/notifications');
    expect(status).toBe(401);
  });

  it('clear-all empties only the caller’s inbox', async () => {
    await notifyUser(db(), orgAPeer.userId, {
      orgId: orgA.orgId, kind: 'system', title: 'Peer keeps this',
    });

    const cleared = await callJson('DELETE', '/api/notifications', { token: orgA.token });
    expect(cleared.status).toBe(200);

    const mine = await callJson('GET', '/api/notifications', { token: orgA.token });
    expect(mine.json.notifications).toHaveLength(0);

    const peers = await callJson('GET', '/api/notifications', { token: orgAPeer.token });
    expect(peers.json.notifications).toHaveLength(1);
    expect(peers.json.notifications[0].title).toBe('Peer keeps this');
  });
});

// ── Member preferences ───────────────────────────────────────────────────────

describe('preferences — member half of the gate', () => {
  beforeAll(async () => {
    await wipe();
    await resetPolicy(orgA.orgId);
  });

  it('round-trips a preference and immediately changes what gets written', async () => {
    const put = await callJson('PUT', '/api/notifications/preferences', {
      token: orgA.token, body: { calc: false },
    });
    expect(put.status).toBe(200);
    expect(put.json.prefs.calc).toBe(false);
    expect(put.json.prefs.permit).toBe(true); // partial patch left the rest alone

    const result = await notifyUser(db(), orgA.userId, {
      orgId: orgA.orgId, kind: 'calc', title: 'Calc finished',
    });
    expect(result).toBe('suppressed');

    const get = await callJson('GET', '/api/notifications/preferences', { token: orgA.token });
    expect(get.json.prefs.calc).toBe(false);
    expect(get.json.effective.calc).toBe(false);
  });

  it('reports effective delivery, not just the raw preference, when the org forces a kind', async () => {
    await setPolicy(orgA.orgId, { calc: 'forced_on' });

    const get = await callJson('GET', '/api/notifications/preferences', { token: orgA.token });
    expect(get.json.prefs.calc).toBe(false);       // the member's own choice, unchanged
    expect(get.json.policy.calc).toBe('forced_on');
    expect(get.json.effective.calc).toBe(true);    // …but the org overrides it

    await resetPolicy(orgA.orgId);
  });

  it('rejects a patch with no valid fields', async () => {
    const { status } = await callJson('PUT', '/api/notifications/preferences', {
      token: orgA.token, body: { nonsense: true, calc: 'yes' },
    });
    expect(status).toBe(400);
  });

  it('a member can only ever write their own preferences', async () => {
    // There is no id in the route — the session is the only addressing. Prove
    // one member's write does not touch another's stored map.
    await callJson('PUT', '/api/notifications/preferences', {
      token: orgAPeer.token, body: { team: false },
    });

    const mine = await callJson('GET', '/api/notifications/preferences', { token: orgA.token });
    expect(mine.json.prefs.team).toBe(true);

    const theirs = await callJson('GET', '/api/notifications/preferences', { token: orgAPeer.token });
    expect(theirs.json.prefs.team).toBe(false);
  });
});
