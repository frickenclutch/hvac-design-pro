/**
 * MICROSOFT SSO — confirm-your-email linking (security audit 2026-11-18, A-1).
 *
 * When a Microsoft account's email is not vouched for by its directory, the
 * callback emails a 6-digit code to that address and holds the sign-in. This
 * suite covers the second leg: POST /api/auth/sso/microsoft/link.
 *
 * The Microsoft token exchange can't run in the harness, so each test seeds
 * the sso_link_challenges row the callback would have written and drives the
 * REAL endpoint against the REAL D1 — nothing else is mocked.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, seedTenant, callJson, type SeededTenant } from './helpers/harness';
import { generateId } from '../src/utils/id';
import { hashToken } from '../src/utils/crypto';
import { buildSsoLinkEmail } from '../src/utils/email';

const db = () => (env as unknown as { DB: D1Database }).DB;

let host: SeededTenant;
let seq = 0;

beforeAll(async () => {
  await applyMigrations(db());
  host = await seedTenant(db(), {
    slug: 'sso-link-org', name: 'SSO Link Org', email: 'owner@ssolink.test', role: 'admin',
  });
});

async function seedUser(
  email: string,
  opts: { role?: string; verified?: boolean; subject?: string | null } = {},
): Promise<string> {
  const id = generateId();
  await db().prepare(
    `INSERT INTO users (id, org_id, email, password_hash, role, first_name, last_name,
                        is_verified, is_platform_admin, is_permit_authority, status,
                        sso_provider, sso_subject)
     VALUES (?, ?, ?, 'x:y', ?, 'Pat', 'Linker', ?, 0, 0, 'active', ?, ?)`,
  ).bind(
    id, host.orgId, email, opts.role ?? 'tech', opts.verified === false ? 0 : 1,
    opts.subject ? 'microsoft' : null, opts.subject ?? null,
  ).run();
  return id;
}

async function seedChallenge(
  email: string,
  opts: { code?: string; subject?: string; expiresInMs?: number } = {},
): Promise<{ linkToken: string; code: string; subject: string }> {
  seq += 1;
  const linkToken = `link-token-${seq}-${generateId()}`;
  const code = opts.code ?? '424242';
  const subject = opts.subject ?? `tenant-x:object-${seq}`;
  await db().prepare(
    `INSERT INTO sso_link_challenges
       (id, provider, token_hash, subject, email, first_name, last_name, code_hash, expires_at)
     VALUES (?, 'microsoft', ?, ?, ?, 'Pat', 'Linker', ?, ?)`,
  ).bind(
    generateId(), await hashToken(linkToken), subject, email,
    await hashToken(`${linkToken}:${code}`),
    new Date(Date.now() + (opts.expiresInMs ?? 600_000)).toISOString(),
  ).run();
  return { linkToken, code, subject };
}

const link = (linkToken: string, code: string) =>
  callJson('POST', '/api/auth/sso/microsoft/link', { body: { linkToken, code } });

const userRow = (id: string) =>
  db().prepare(
    `SELECT sso_provider, sso_subject, password_hash, is_verified FROM users WHERE id = ?`,
  ).bind(id).first<{
    sso_provider: string | null; sso_subject: string | null; password_hash: string | null; is_verified: number;
  }>();

const attemptsFor = async (linkToken: string) =>
  (await db().prepare(`SELECT attempts FROM sso_link_challenges WHERE token_hash = ?`)
    .bind(await hashToken(linkToken)).first<{ attempts: number }>())?.attempts;

describe('POST /api/auth/sso/microsoft/link', () => {
  it('a wrong code does not link; the right code then binds the subject and signs in', async () => {
    const uid = await seedUser('link-ok@ssolink.test');
    const ch = await seedChallenge('link-ok@ssolink.test');

    const bad = await link(ch.linkToken, '000000');
    expect(bad.status).toBe(401);
    expect((await userRow(uid))?.sso_subject).toBeNull();

    const good = await link(ch.linkToken, ch.code);
    expect(good.status).toBe(200);
    expect(typeof good.json.token).toBe('string');
    expect(good.json.user.id).toBe(uid);

    const row = await userRow(uid);
    expect(row?.sso_provider).toBe('microsoft');
    expect(row?.sso_subject).toBe(ch.subject);
    // An already-verified account keeps its password.
    expect(row?.password_hash).toBe('x:y');
  });

  it('a challenge is single-use', async () => {
    await seedUser('link-once@ssolink.test');
    const ch = await seedChallenge('link-once@ssolink.test');
    expect((await link(ch.linkToken, ch.code)).status).toBe(200);
    const again = await link(ch.linkToken, ch.code);
    expect(again.status).toBe(401);
    expect(again.json.ssoLinkExpired).toBe(true);
  });

  it('locks after five wrong codes and then refuses the correct one', async () => {
    const uid = await seedUser('link-lock@ssolink.test');
    const ch = await seedChallenge('link-lock@ssolink.test');
    for (let i = 0; i < 5; i++) {
      expect((await link(ch.linkToken, '111111')).status).toBe(401);
    }
    const locked = await link(ch.linkToken, ch.code);
    expect(locked.status).toBe(429);
    expect(locked.json.token).toBeUndefined();
    expect((await userRow(uid))?.sso_subject).toBeNull();
  });

  it('parallel guesses cannot exceed the attempt cap', async () => {
    await seedUser('link-race@ssolink.test');
    const ch = await seedChallenge('link-race@ssolink.test');
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => link(ch.linkToken, String(100000 + i))),
    );
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
    expect(results.some((r) => r.status === 200)).toBe(false);
    expect(await attemptsFor(ch.linkToken)).toBe(5);
  });

  it('rejects an expired challenge and an unknown token', async () => {
    await seedUser('link-old@ssolink.test');
    const ch = await seedChallenge('link-old@ssolink.test', { expiresInMs: -1000 });
    expect((await link(ch.linkToken, ch.code)).status).toBe(401);
    expect((await link('no-such-token', '424242')).status).toBe(401);
  });

  it('rejects malformed input without spending an attempt', async () => {
    const ch = await seedChallenge('link-fmt@ssolink.test');
    expect((await link(ch.linkToken, '12345')).status).toBe(400);
    expect((await link(ch.linkToken, 'abcdef')).status).toBe(400);
    expect((await link('', ch.code)).status).toBe(400);
    expect(await attemptsFor(ch.linkToken)).toBe(0);
  });

  it('will not re-bind an account already linked to a different Microsoft identity', async () => {
    const uid = await seedUser('link-taken@ssolink.test', { subject: 'tenant-real:object-real' });
    const ch = await seedChallenge('link-taken@ssolink.test', { subject: 'tenant-evil:object-evil' });
    const res = await link(ch.linkToken, ch.code);
    expect(res.status).toBe(409);
    expect(res.json.token).toBeUndefined();
    expect((await userRow(uid))?.sso_subject).toBe('tenant-real:object-real');
  });

  it('discards the password on an unverified (possibly squatted) account when linking', async () => {
    const uid = await seedUser('link-squat@ssolink.test', { verified: false });
    const ch = await seedChallenge('link-squat@ssolink.test');
    expect((await link(ch.linkToken, ch.code)).status).toBe(200);
    const row = await userRow(uid);
    expect(row?.is_verified).toBe(1);
    expect(row?.password_hash).toBeNull();
    expect(row?.sso_subject).toBe(ch.subject);
  });

  it('creates a subject-bound account when no account has that email', async () => {
    const ch = await seedChallenge('brand-new@ssolink.test');
    const res = await link(ch.linkToken, ch.code);
    // A new SSO user is the admin of their own workspace, and admins must
    // enrol MFA — so the answer is a session or the forced-enrolment handoff,
    // never a refusal.
    expect([200, 403]).toContain(res.status);
    if (res.status === 403) expect(res.json.enrollmentRequired).toBe(true);

    const row = await db().prepare(
      `SELECT sso_subject, is_verified, password_hash FROM users WHERE email = 'brand-new@ssolink.test'`,
    ).first<{ sso_subject: string; is_verified: number; password_hash: string | null }>();
    expect(row?.sso_subject).toBe(ch.subject);
    expect(row?.is_verified).toBe(1);
    expect(row?.password_hash).toBeNull();
  });

  it('matches a returning user on subject even after their directory email changes', async () => {
    const uid = await seedUser('old-address@ssolink.test', { subject: 'tenant-keep:object-keep' });
    const ch = await seedChallenge('new-address@ssolink.test', { subject: 'tenant-keep:object-keep' });
    const res = await link(ch.linkToken, ch.code);
    expect(res.status).toBe(200);
    expect(res.json.user.id).toBe(uid);
    expect(res.json.user.email).toBe('old-address@ssolink.test');
    const dup = await db().prepare(`SELECT id FROM users WHERE email = 'new-address@ssolink.test'`).first();
    expect(dup).toBeNull();
  });

  it('refuses to sign in a deactivated account', async () => {
    const uid = await seedUser('link-gone@ssolink.test');
    await db().prepare(`UPDATE users SET status = 'deactivated' WHERE id = ?`).bind(uid).run();
    const ch = await seedChallenge('link-gone@ssolink.test');
    const res = await link(ch.linkToken, ch.code);
    expect(res.status).toBe(403);
    expect(res.json.token).toBeUndefined();
  });
});

describe('confirm-email message', () => {
  it('carries the code in the body but keeps it out of the logged subject', () => {
    const mail = buildSsoLinkEmail('918273');
    expect(mail.html).toContain('918273');
    expect(mail.subject).not.toContain('918273');
  });
});
