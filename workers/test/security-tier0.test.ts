/**
 * SECURITY AUDIT 2026-11-18 — Tier 0 regression cover.
 *
 * One block per finding in docs/SECURITY_AUDIT_2026-11-18.md:
 *   A-1  Microsoft SSO identity is the directory subject, never a bare email
 *   A-2  rate-limit cleanup must not wipe live throttle state
 *   A-3  pending-invite tokens are returned to admins only
 *   A-5  email templates escape every interpolated value; names are validated
 *   A-6  a hostile request body cannot suppress its own audit row
 *
 * Same real-worker + real-D1 harness as the other suites — nothing mocked.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, seedTenant, callJson, type SeededTenant } from './helpers/harness';
import { generateId } from '../src/utils/id';
import { mintTokenPair } from '../src/utils/session';
import { cleanupRateLimitEvents, checkRateLimit, recordRateLimitEvent } from '../src/utils/rateLimit';
import { resolveMicrosoftIdentity } from '../src/utils/oauth';
import { buildVerificationEmail, buildInviteEmail, escapeHtml } from '../src/utils/email';

const db = () => (env as unknown as { DB: D1Database }).DB;

let admin: SeededTenant;
let viewerToken: string;

beforeAll(async () => {
  await applyMigrations(db());
  admin = await seedTenant(db(), {
    slug: 't0-org', name: 'Tier Zero Org', email: 'admin@t0.test', role: 'admin',
  });

  // A viewer in the SAME org as the admin (seedTenant makes one user per org).
  const viewerId = generateId();
  await db().prepare(
    `INSERT INTO users (id, org_id, email, password_hash, role, first_name, last_name,
                        is_verified, is_platform_admin, is_permit_authority, status)
     VALUES (?, ?, 'viewer@t0.test', 'x:y', 'viewer', 'View', 'Only', 1, 0, 0, 'active')`,
  ).bind(viewerId, admin.orgId).run();
  viewerToken = (await mintTokenPair(db(), viewerId, admin.orgId)).accessToken;
});

// ── A-2 ────────────────────────────────────────────────────────────────────
describe('A-2 rate-limit cleanup', () => {
  it('keeps events inside the window and removes only stale ones', async () => {
    await recordRateLimitEvent(db(), 'victim@t0.test', 'login');
    await recordRateLimitEvent(db(), 'victim@t0.test', 'login');
    await db().prepare(
      `INSERT INTO rate_limit_events (id, identifier, action, created_at)
       VALUES (?, 'stale@t0.test', 'login', datetime('now', '-3 hours'))`,
    ).bind(generateId()).run();

    await cleanupRateLimitEvents(db());

    const fresh = await db().prepare(
      `SELECT COUNT(*) AS n FROM rate_limit_events WHERE identifier = 'victim@t0.test'`,
    ).first<{ n: number }>();
    const stale = await db().prepare(
      `SELECT COUNT(*) AS n FROM rate_limit_events WHERE identifier = 'stale@t0.test'`,
    ).first<{ n: number }>();
    expect(fresh?.n).toBe(2);
    expect(stale?.n).toBe(0);
  });

  it('a throttled bucket stays throttled after cleanup runs', async () => {
    for (let i = 0; i < 5; i++) await recordRateLimitEvent(db(), 'locked@t0.test', 'login');
    await cleanupRateLimitEvents(db());
    const res = await checkRateLimit(db(), 'locked@t0.test', 'login', 5, 15);
    expect(res.allowed).toBe(false);
  });
});

// ── A-3 ────────────────────────────────────────────────────────────────────
describe('A-3 invite tokens', () => {
  it('returns the token to an admin and strips it for a viewer', async () => {
    const created = await callJson('POST', '/api/org/invite', {
      token: admin.token, body: { email: 'newhire@t0.test', role: 'admin' },
    });
    expect(created.status).toBeLessThan(300);

    const asAdmin = await callJson('GET', '/api/org/team', { token: admin.token });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.json.invites.length).toBe(1);
    expect(typeof asAdmin.json.invites[0].token).toBe('string');

    const asViewer = await callJson('GET', '/api/org/team', { token: viewerToken });
    expect(asViewer.status).toBe(200);
    expect(asViewer.json.invites.length).toBe(1);
    expect(asViewer.json.invites[0].invited_email).toBe('newhire@t0.test');
    expect('token' in asViewer.json.invites[0]).toBe(false);
    expect(JSON.stringify(asViewer.json)).not.toContain(asAdmin.json.invites[0].token);
  });
});

// ── A-5 ────────────────────────────────────────────────────────────────────
describe('A-5 email HTML escaping + name validation', () => {
  const payload = '</h1><a href="https://evil.example">Sign in</a><!--';

  it('escapeHtml neutralises markup and quotes', () => {
    expect(escapeHtml(payload)).not.toMatch(/[<>"]/);
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('verification email never carries caller-supplied markup', () => {
    const { html } = buildVerificationEmail(payload, '123456');
    expect(html).not.toContain('evil.example">');
    expect(html).toContain('&lt;/h1&gt;');
    expect(html).toContain('123456');
  });

  it('invite email escapes org and inviter names in body, and keeps the subject one line', () => {
    const mail = buildInviteEmail({
      orgName: `<b>Acme</b>\r\nBcc: x@evil.example`,
      inviterName: payload,
      inviterEmail: `a"onmouseover="x@evil.example`,
      invitedRole: 'tech',
      redeemUrl: 'https://hvac-design-pro.pages.dev/onboarding?invite=abc',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(mail.html).not.toContain('<b>Acme</b>');
    expect(mail.html).not.toContain('evil.example">Sign in');
    expect(mail.html).not.toContain('a"onmouseover');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('register rejects markup in a name', async () => {
    const res = await callJson('POST', '/api/auth/register', {
      body: { email: 'x@t0.test', password: 'correct horse battery', firstName: payload, lastName: 'Ok' },
    });
    expect(res.status).toBe(400);
    const row = await db().prepare(`SELECT id FROM users WHERE email = 'x@t0.test'`).first();
    expect(row).toBeNull();
  });

  it('register rejects a non-string name', async () => {
    const res = await callJson('POST', '/api/auth/register', {
      body: { email: 'y@t0.test', password: 'correct horse battery', firstName: { a: 1 }, lastName: 'Ok' },
    });
    expect(res.status).toBe(400);
  });
});

// ── A-6 ────────────────────────────────────────────────────────────────────
describe('A-6 audit rows survive hostile body values', () => {
  it('a numeric label still produces the semantic audit row', async () => {
    const res = await callJson('PUT', '/api/org/authority', {
      token: admin.token, body: { authorityType: 'general', authorityTitle: 7 },
    });
    expect(res.status).toBeLessThan(300);
    const row = await db().prepare(
      `SELECT action, entity_label FROM audit_log
       WHERE path = '/api/org/authority' AND user_id = ? ORDER BY rowid DESC LIMIT 1`,
    ).bind(admin.userId).first<{ action: string; entity_label: string | null }>();
    expect(row).not.toBeNull();
    expect(row?.action).not.toBe('api.put');
    expect(row?.entity_label).toBe('7');
  });
});

// ── A-1 ────────────────────────────────────────────────────────────────────
describe('A-1 Microsoft identity resolution', () => {
  const CLIENT = 'client-123';
  const jwt = (claims: Record<string, unknown>) =>
    `e30.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig`;
  const good = { aud: CLIENT, tid: 'tenant-a', oid: 'object-1' };

  it('uses tid:oid as the subject', () => {
    const id = resolveMicrosoftIdentity(CLIENT, jwt(good), { mail: null, userPrincipalName: 'Sam@Corp.com' });
    expect(id).toEqual({ ok: true, subject: 'tenant-a:object-1', email: 'sam@corp.com', emailVerifiedByDirectory: true });
  });

  it('does NOT trust a mail attribute that differs from the sign-in name', () => {
    const id = resolveMicrosoftIdentity(CLIENT, jwt(good), {
      mail: 'victim@victimco.com', userPrincipalName: 'attacker@evil.onmicrosoft.com',
    });
    expect(id.ok).toBe(true);
    if (id.ok) {
      expect(id.email).toBe('victim@victimco.com');
      expect(id.emailVerifiedByDirectory).toBe(false);
    }
  });

  it('trusts mail when it equals the sign-in name', () => {
    const id = resolveMicrosoftIdentity(CLIENT, jwt(good), { mail: 'sam@corp.com', userPrincipalName: 'sam@corp.com' });
    expect(id.ok && id.emailVerifiedByDirectory).toBe(true);
  });

  it('never treats a guest (#EXT#) sign-in name as a verified email', () => {
    const id = resolveMicrosoftIdentity(CLIENT, jwt(good), {
      mail: 'victim@victimco.com', userPrincipalName: 'victim_victimco.com#EXT#@evil.onmicrosoft.com',
    });
    expect(id.ok && id.emailVerifiedByDirectory).toBe(false);
  });

  it('rejects a token issued to another application', () => {
    const id = resolveMicrosoftIdentity(CLIENT, jwt({ ...good, aud: 'someone-else' }), { mail: null, userPrincipalName: 'sam@corp.com' });
    expect(id).toEqual({ ok: false, reason: 'audience_mismatch' });
  });

  it('rejects a missing or unreadable id_token and missing subject claims', () => {
    expect(resolveMicrosoftIdentity(CLIENT, undefined, { mail: null, userPrincipalName: 'a@b.co' }).ok).toBe(false);
    expect(resolveMicrosoftIdentity(CLIENT, 'not-a-jwt', { mail: null, userPrincipalName: 'a@b.co' }).ok).toBe(false);
    expect(resolveMicrosoftIdentity(CLIENT, jwt({ aud: CLIENT, tid: 'tenant-a' }), { mail: null, userPrincipalName: 'a@b.co' }).ok).toBe(false);
  });
});
