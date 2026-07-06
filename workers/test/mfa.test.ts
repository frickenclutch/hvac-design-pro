/**
 * MFA (TOTP) — Worker integration tests.
 *
 * Drives the FULL second-factor flow through the REAL Hono app, the REAL
 * authMiddleware, and a REAL Miniflare D1 seeded with the production migrations
 * 0001-0014. Sessions are minted via the production mintTokenPair(); TOTP codes
 * are computed in-runtime with the same RFC-6238 HOTP the worker verifies
 * (test/helpers/harness `totpNow`). Nothing is mocked.
 *
 * Coverage (matches the unit's acceptance list):
 *   (a) non-MFA user logs in unchanged — full session, no challenge
 *   (b) enrolled user's password login → 202 + challenge, NO session;
 *       /mfa/challenge with a VALID TOTP mints the session, INVALID does not
 *   (c) a replayed/consumed challenge token is rejected (single-use)
 *   (d) required-not-enrolled admin login → 403 enrollmentRequired (not a
 *       lockout); enroll-grace + confirm-grace mints the session
 *   (e) a backup code works once and is rejected on reuse
 *   (f) rate-limit lockout after N failed challenge attempts
 *   (g) enroll refuses (503) when MFA_ENC_KEY is unset
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
  applyMigrations,
  seedTenant,
  callJson,
  totpNow,
  wrongTotp,
  type SeededTenant,
} from './helpers/harness';

const db = () => (env as unknown as { DB: D1Database }).DB;

// A direct password we can set on a seeded user so we can drive the REAL login.
// We seed users with a known PBKDF2 hash by registering via the API, OR by
// inserting a hash we control. Simplest: register through /api/auth/register
// then mark verified — but that path creates its own org. To keep tests tight
// and use seedTenant's known orgs, we set the password hash directly.
import { hashPassword } from '../src/utils/crypto';

const PASSWORD = 'Sup3rSecret!';

/** Give a seeded user a real, login-usable password hash. */
async function setPassword(userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, userId).run();
}

/** Enroll + confirm MFA for an AUTHED user; returns { secret, backupCodes }. */
async function enrollAndConfirm(token: string): Promise<{ secret: string; backupCodes: string[] }> {
  const enroll = await callJson('POST', '/api/auth/mfa/enroll', { token });
  expect(enroll.status).toBe(200);
  const secret = enroll.json.secret as string;
  const code = await totpNow(secret);
  const confirm = await callJson('POST', '/api/auth/mfa/confirm', { token, body: { code } });
  expect(confirm.status).toBe(200);
  expect(confirm.json.enabled).toBe(true);
  return { secret, backupCodes: confirm.json.backupCodes as string[] };
}

let plain: SeededTenant;     // ordinary tech user, no MFA, not required
let enrolled: SeededTenant;  // tech user who will enroll TOTP
let adminReq: SeededTenant;  // admin (MFA required) not yet enrolled

beforeAll(async () => {
  await applyMigrations(db());

  plain = await seedTenant(db(), {
    slug: 'mfa-plain', name: 'Plain Co', email: 'plain@mfa.test', role: 'tech',
  });
  enrolled = await seedTenant(db(), {
    slug: 'mfa-enrolled', name: 'Enrolled Co', email: 'enrolled@mfa.test', role: 'tech',
  });
  adminReq = await seedTenant(db(), {
    slug: 'mfa-admin', name: 'Admin Co', email: 'admin@mfa.test', role: 'admin',
  });

  await setPassword(plain.userId, PASSWORD);
  await setPassword(enrolled.userId, PASSWORD);
  await setPassword(adminReq.userId, PASSWORD);
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Non-MFA, non-required user logs in UNCHANGED — full session, no challenge.
// ─────────────────────────────────────────────────────────────────────────────
describe('(a) non-MFA login is unchanged', () => {
  it('password login → 200 full session, no mfaRequired', async () => {
    const { status, json } = await callJson('POST', '/api/auth/login', {
      body: { email: plain.email, password: PASSWORD },
    });
    expect(status).toBe(200);
    expect(json.token).toBeTruthy();
    expect(json.refreshToken).toBeTruthy();
    expect(json.user?.id).toBe(plain.userId);
    expect(json.mfaRequired).toBeUndefined();
    expect(json.enrollmentRequired).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Enrolled user → 202 challenge, no session; VALID TOTP mints, INVALID not.
// ─────────────────────────────────────────────────────────────────────────────
describe('(b) enrolled user is challenged on login', () => {
  let secret: string;

  it('enroll + confirm activates TOTP', async () => {
    const r = await enrollAndConfirm(enrolled.token);
    secret = r.secret;
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(r.backupCodes.length).toBe(10);
  });

  it('status reports enabled + backup count', async () => {
    const { status, json } = await callJson('GET', '/api/auth/mfa/status', { token: enrolled.token });
    expect(status).toBe(200);
    expect(json.enabled).toBe(true);
    expect(json.method).toBe('totp');
    expect(json.backupCodesRemaining).toBe(10);
  });

  it('password login now returns 202 + challenge, NO session token', async () => {
    const { status, json } = await callJson('POST', '/api/auth/login', {
      body: { email: enrolled.email, password: PASSWORD },
    });
    expect(status).toBe(202);
    expect(json.mfaRequired).toBe(true);
    expect(json.mfaChallengeToken).toBeTruthy();
    expect(json.token).toBeUndefined();      // critical: no session on password alone
    expect(json.refreshToken).toBeUndefined();
  });

  it('challenge with INVALID code → 401, no session', async () => {
    const login = await callJson('POST', '/api/auth/login', {
      body: { email: enrolled.email, password: PASSWORD },
    });
    const challengeToken = login.json.mfaChallengeToken as string;
    const bad = await wrongTotp(secret);
    const { status, json } = await callJson('POST', '/api/auth/mfa/challenge', {
      body: { challengeToken, code: bad, method: 'totp' },
    });
    expect(status).toBe(401);
    expect(json.token).toBeUndefined();
  });

  it('challenge with VALID TOTP → 200 full session', async () => {
    const login = await callJson('POST', '/api/auth/login', {
      body: { email: enrolled.email, password: PASSWORD },
    });
    const challengeToken = login.json.mfaChallengeToken as string;
    const code = await totpNow(secret);
    const { status, json } = await callJson('POST', '/api/auth/mfa/challenge', {
      body: { challengeToken, code, method: 'totp' },
    });
    expect(status).toBe(200);
    expect(json.token).toBeTruthy();
    expect(json.refreshToken).toBeTruthy();
    expect(json.user?.id).toBe(enrolled.userId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) A consumed challenge token is single-use — replay is rejected.
// ─────────────────────────────────────────────────────────────────────────────
describe('(c) challenge tokens are single-use', () => {
  it('a verified challenge cannot be replayed', async () => {
    // Fresh enrolled identity so prior tests' rate-limit budget is irrelevant.
    const u = await seedTenant(db(), { slug: 'mfa-replay', name: 'Replay Co', email: 'replay@mfa.test', role: 'tech' });
    await setPassword(u.userId, PASSWORD);
    const { secret } = await enrollAndConfirm(u.token);

    const login = await callJson('POST', '/api/auth/login', { body: { email: u.email, password: PASSWORD } });
    const challengeToken = login.json.mfaChallengeToken as string;
    const code = await totpNow(secret);

    const first = await callJson('POST', '/api/auth/mfa/challenge', { body: { challengeToken, code, method: 'totp' } });
    expect(first.status).toBe(200);
    expect(first.json.token).toBeTruthy();

    // Replay the SAME consumed token (same code window).
    const replay = await callJson('POST', '/api/auth/mfa/challenge', { body: { challengeToken, code, method: 'totp' } });
    expect(replay.status).toBe(401);
    expect(replay.json.token).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Required-not-enrolled admin → 403 enrollmentRequired (NOT a lockout);
//     enroll-grace + confirm-grace mints the session in one flow.
// ─────────────────────────────────────────────────────────────────────────────
describe('(d) required-not-enrolled admin gets a grace path, never a lockout', () => {
  let enrollToken: string;
  let secret: string;

  it('admin login → 403 enrollmentRequired with a grace token (no session)', async () => {
    const { status, json } = await callJson('POST', '/api/auth/login', {
      body: { email: adminReq.email, password: PASSWORD },
    });
    expect(status).toBe(403);
    expect(json.enrollmentRequired).toBe(true);
    expect(json.mfaEnrollToken).toBeTruthy();
    expect(json.token).toBeUndefined();
    enrollToken = json.mfaEnrollToken as string;
  });

  it('enroll-grace returns a secret without a session', async () => {
    const { status, json } = await callJson('POST', '/api/auth/mfa/enroll-grace', {
      body: { mfaEnrollToken: enrollToken },
    });
    expect(status).toBe(200);
    expect(json.secret).toBeTruthy();
    expect(json.token).toBeUndefined();
    secret = json.secret as string;
  });

  it('confirm-grace mints the session + returns backup codes', async () => {
    const code = await totpNow(secret);
    const { status, json } = await callJson('POST', '/api/auth/mfa/confirm-grace', {
      body: { mfaEnrollToken: enrollToken, code },
    });
    expect(status).toBe(200);
    expect(json.token).toBeTruthy();          // landed logged-in
    expect(json.refreshToken).toBeTruthy();
    expect(json.user?.id).toBe(adminReq.userId);
    expect(Array.isArray(json.backupCodes)).toBe(true);
    expect(json.backupCodes.length).toBe(10);
  });

  it('the enroll token is single-use (confirm-grace replay rejected)', async () => {
    const code = await totpNow(secret);
    const { status } = await callJson('POST', '/api/auth/mfa/confirm-grace', {
      body: { mfaEnrollToken: enrollToken, code },
    });
    expect(status).toBe(401);
  });

  it('that admin is now enrolled → subsequent login is challenged (202)', async () => {
    const { status, json } = await callJson('POST', '/api/auth/login', {
      body: { email: adminReq.email, password: PASSWORD },
    });
    expect(status).toBe(202);
    expect(json.mfaRequired).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) A backup code works once, then is rejected on reuse.
// ─────────────────────────────────────────────────────────────────────────────
describe('(e) backup codes are one-time', () => {
  it('a backup code mints a session once, fails on replay', async () => {
    const u = await seedTenant(db(), { slug: 'mfa-backup', name: 'Backup Co', email: 'backup@mfa.test', role: 'tech' });
    await setPassword(u.userId, PASSWORD);
    const { backupCodes } = await enrollAndConfirm(u.token);
    const oneCode = backupCodes[0];

    // First use — mints a session.
    const login1 = await callJson('POST', '/api/auth/login', { body: { email: u.email, password: PASSWORD } });
    const tok1 = login1.json.mfaChallengeToken as string;
    const r1 = await callJson('POST', '/api/auth/mfa/challenge', { body: { challengeToken: tok1, code: oneCode, method: 'backup' } });
    expect(r1.status).toBe(200);
    expect(r1.json.token).toBeTruthy();

    // Reuse the SAME backup code on a fresh challenge — rejected.
    const login2 = await callJson('POST', '/api/auth/login', { body: { email: u.email, password: PASSWORD } });
    const tok2 = login2.json.mfaChallengeToken as string;
    const r2 = await callJson('POST', '/api/auth/mfa/challenge', { body: { challengeToken: tok2, code: oneCode, method: 'backup' } });
    expect(r2.status).toBe(401);
    expect(r2.json.token).toBeUndefined();

    // A DIFFERENT, unused backup code still works.
    const login3 = await callJson('POST', '/api/auth/login', { body: { email: u.email, password: PASSWORD } });
    const tok3 = login3.json.mfaChallengeToken as string;
    const r3 = await callJson('POST', '/api/auth/mfa/challenge', { body: { challengeToken: tok3, code: backupCodes[1], method: 'backup' } });
    expect(r3.status).toBe(200);
    expect(r3.json.token).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) Rate-limit lockout after N failed challenge attempts.
// ─────────────────────────────────────────────────────────────────────────────
describe('(f) failed challenge attempts lock out', () => {
  it('5 bad codes then a 6th attempt → 429', async () => {
    const u = await seedTenant(db(), { slug: 'mfa-rl', name: 'RL Co', email: 'rl@mfa.test', role: 'tech' });
    await setPassword(u.userId, PASSWORD);
    const { secret } = await enrollAndConfirm(u.token);

    const login = await callJson('POST', '/api/auth/login', { body: { email: u.email, password: PASSWORD } });
    const challengeToken = login.json.mfaChallengeToken as string;
    const bad = await wrongTotp(secret);

    // 5 failures consume the per-user budget (limit = 5/15min, recorded on fail).
    for (let i = 0; i < 5; i++) {
      const r = await callJson('POST', '/api/auth/mfa/challenge', { body: { challengeToken, code: bad, method: 'totp' } });
      expect(r.status).toBe(401);
    }
    // The 6th attempt is locked out BEFORE verification.
    const sixth = await callJson('POST', '/api/auth/mfa/challenge', { body: { challengeToken, code: bad, method: 'totp' } });
    expect(sixth.status).toBe(429);

    // Even a now-VALID code is refused while locked out.
    const good = await totpNow(secret);
    const blocked = await callJson('POST', '/api/auth/mfa/challenge', { body: { challengeToken, code: good, method: 'totp' } });
    expect(blocked.status).toBe(429);
    expect(blocked.json.token).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) Enroll refuses (503) when MFA_ENC_KEY is unset — never stores plaintext.
// ─────────────────────────────────────────────────────────────────────────────
describe('(g) enroll refuses when MFA_ENC_KEY is unset', () => {
  it('POST /api/auth/mfa/enroll → 503 with the key removed', async () => {
    const u = await seedTenant(db(), { slug: 'mfa-nokey', name: 'NoKey Co', email: 'nokey@mfa.test', role: 'tech' });
    const mutable = env as unknown as { MFA_ENC_KEY?: string };
    const saved = mutable.MFA_ENC_KEY;
    try {
      delete mutable.MFA_ENC_KEY;
      const { status, json } = await callJson('POST', '/api/auth/mfa/enroll', { token: u.token });
      expect(status).toBe(503);
      expect(json.error).toMatch(/not configured/i);
      // And nothing was written — no credential row exists.
      const row = await db().prepare('SELECT id FROM mfa_credentials WHERE user_id = ?').bind(u.userId).first();
      expect(row).toBeNull();
    } finally {
      mutable.MFA_ENC_KEY = saved;
    }
  });
});
