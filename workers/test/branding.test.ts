/**
 * TENANT BRANDING — validation, role gating, isolation, and the public logo
 * route's key confinement.
 *
 * The property that matters most: the logo is served by a PUBLIC route, and an
 * admin can write the raw settings blob through PUT /api/org. So a stored
 * `logoKey` must never be trusted — it is re-validated against the org's own
 * `org-logos/<orgId>/` prefix on every read. The "planted key" test below is
 * what proves a hostile settings blob cannot turn /org-logos into an
 * arbitrary-bucket-object reader.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, seedTenant, call, callJson, type SeededTenant } from './helpers/harness';
import {
  resolveBranding,
  sanitizeBrandingPatch,
  isOwnLogoKey,
  normalizeHex,
  canWhiteLabel,
  mergeBrandingIntoSettings,
  DEFAULT_BRANDING,
} from '../src/utils/branding';

const db = () => (env as unknown as { DB: D1Database }).DB;
const storage = () => (env as unknown as { STORAGE: R2Bucket }).STORAGE;

describe('branding — pure validation', () => {
  it('accepts only strict #rrggbb', () => {
    expect(normalizeHex('#0B5FA5')).toBe('#0b5fa5');
    expect(normalizeHex('#fff')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('#0b5fa5; background:url(x)')).toBeNull();
    expect(normalizeHex(123)).toBeNull();
  });

  it('confines logo keys to the org prefix', () => {
    expect(isOwnLogoKey('org-logos/org1/abc123.png', 'org1')).toBe(true);
    expect(isOwnLogoKey('org-logos/org2/abc123.png', 'org1')).toBe(false);
    expect(isOwnLogoKey('uploads/org1/plan.pdf', 'org1')).toBe(false);
    expect(isOwnLogoKey('org-logos/org1/../../uploads/x.png', 'org1')).toBe(false);
    expect(isOwnLogoKey('org-logos/org1/a.svg', 'org1')).toBe(false);
  });

  it('resolves hostile stored settings to safe defaults', () => {
    const settings = JSON.stringify({
      branding: {
        displayName: '<img src=x onerror=alert(1)>',
        primaryColor: 'javascript:alert(1)',
        logoKey: 'uploads/other-org/secret.pdf',
        whiteLabel: 'yes',
      },
    });
    expect(resolveBranding(settings, 'org1')).toEqual(DEFAULT_BRANDING);
    expect(resolveBranding('not json', 'org1')).toEqual(DEFAULT_BRANDING);
  });

  it('never lets a PUT body set logoKey, and reports invalid fields', () => {
    const r = sanitizeBrandingPatch({ logoKey: 'org-logos/org1/x.png', primaryColor: 'blue', displayName: 'Howland Pump' });
    expect(r.patch).toEqual({ displayName: 'Howland Pump' });
    expect(r.invalid).toEqual(['primaryColor']);
    expect(sanitizeBrandingPatch({ displayName: '', primaryColor: null }).patch)
      .toEqual({ displayName: null, primaryColor: null });
  });

  it('gates white-label on plan or L0, and preserves other settings keys', () => {
    expect(canWhiteLabel('starter', false)).toBe(false);
    expect(canWhiteLabel('enterprise', false)).toBe(true);
    expect(canWhiteLabel('starter', true)).toBe(true);
    const merged = JSON.parse(mergeBrandingIntoSettings('{"notificationPolicy":{"calc":"forced_on"}}', DEFAULT_BRANDING));
    expect(merged.notificationPolicy).toEqual({ calc: 'forced_on' });
    expect(merged.branding).toEqual(DEFAULT_BRANDING);
  });
});

describe('branding — routes', () => {
  let admin: SeededTenant;
  let other: SeededTenant;
  let l0: SeededTenant;
  let viewer: SeededTenant;

  beforeAll(async () => {
    await applyMigrations(db());
    admin = await seedTenant(db(), { slug: 'brand-a', name: 'Brand A', email: 'admin@brand-a.test', role: 'admin' });
    other = await seedTenant(db(), { slug: 'brand-b', name: 'Brand B', email: 'admin@brand-b.test', role: 'admin' });
    viewer = await seedTenant(db(), { slug: 'brand-v', name: 'Brand V', email: 'viewer@brand-v.test', role: 'viewer' });
    l0 = await seedTenant(db(), { slug: 'brand-l0', name: 'Platform', email: 'l0@brand.test', role: 'admin', isPlatformAdmin: true });
  });

  it('requires auth', async () => {
    expect((await callJson('GET', '/api/org/branding')).status).toBe(401);
  });

  it('admin updates; members of another org are unaffected', async () => {
    const put = await callJson('PUT', '/api/org/branding', {
      token: admin.token, body: { displayName: 'Howland Pump', primaryColor: '#0B5FA5' },
    });
    expect(put.status).toBe(200);
    expect(put.json.branding.primaryColor).toBe('#0b5fa5');

    const mine = await callJson('GET', '/api/org/branding', { token: admin.token });
    expect(mine.json.branding.displayName).toBe('Howland Pump');
    expect(mine.json.canEdit).toBe(true);

    const theirs = await callJson('GET', '/api/org/branding', { token: other.token });
    expect(theirs.json.branding).toEqual(DEFAULT_BRANDING);
  });

  it('non-admin cannot write; bad colour is a 400', async () => {
    expect((await callJson('PUT', '/api/org/branding', { token: viewer.token, body: { displayName: 'X' } })).status).toBe(403);
    expect((await callJson('PUT', '/api/org/branding', { token: admin.token, body: { primaryColor: 'red' } })).status).toBe(400);
    expect((await callJson('DELETE', '/api/org/branding/logo', { token: viewer.token })).status).toBe(403);
  });

  it('white-label is refused off-plan and grantable by L0', async () => {
    const self = await callJson('PUT', '/api/org/branding', { token: admin.token, body: { whiteLabel: true } });
    expect(self.status).toBe(403);

    expect((await callJson('PUT', `/api/platform/branding/${admin.orgId}`, { token: admin.token, body: { whiteLabel: true } })).status).toBe(403);

    const grant = await callJson('PUT', `/api/platform/branding/${admin.orgId}`, { token: l0.token, body: { whiteLabel: true } });
    expect(grant.status).toBe(200);
    expect(grant.json.branding.whiteLabel).toBe(true);
    // The grant must not wipe what the tenant had already set.
    expect(grant.json.branding.displayName).toBe('Howland Pump');
  });

  it('logo: rejects SVG, serves an uploaded PNG publicly', async () => {
    const svg = new FormData();
    svg.append('file', new File(['<svg onload="alert(1)"/>'], 'x.svg', { type: 'image/svg+xml' }));
    expect((await callJson('POST', '/api/org/branding/logo', { token: admin.token, formData: svg })).status).toBe(400);

    const png = new FormData();
    png.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
    const up = await callJson('POST', '/api/org/branding/logo', { token: admin.token, formData: png });
    expect(up.status).toBe(201);
    expect(up.json.branding.logoKey.startsWith(`org-logos/${admin.orgId}/`)).toBe(true);

    const res = await call('GET', `/org-logos/${admin.orgId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await res.arrayBuffer();
  });

  it('a planted logoKey cannot make the public route serve another object', async () => {
    await storage().put('uploads/secret/floorplan.pdf', 'TOP SECRET', { httpMetadata: { contentType: 'application/pdf' } });
    // Simulate an admin writing the raw settings blob (PUT /api/org allows it).
    await db().prepare(`UPDATE organisations SET settings = ? WHERE id = ?`)
      .bind(JSON.stringify({ branding: { logoKey: 'uploads/secret/floorplan.pdf' } }), other.orgId).run();

    const res = await call('GET', `/org-logos/${other.orgId}`);
    expect(res.status).toBe(404);
    await res.arrayBuffer();
  });
});

// ── Email branding ──────────────────────────────────────────────────────────
import { buildInviteEmail, buildPasswordResetEmail, applyBrandFrom } from '../src/utils/email';
import { brandShade, toEmailBrand } from '../src/utils/branding';

describe('branding — emails', () => {
  const invite = {
    orgName: 'Howland Pump & Supply', inviterName: 'Dan', inviterEmail: 'dan@howland.test',
    invitedRole: 'engineer', redeemUrl: 'https://app.test/onboarding?invite=t', expiresAt: '2027-01-01T00:00:00Z',
  };
  const brand = (over: Record<string, unknown> = {}) => ({
    ...toEmailBrand(
      { displayName: 'Howland Pump', tagline: null, primaryColor: '#0b5fa5', logoKey: 'org-logos/o1/a.png', whiteLabel: false },
      'o1', 'Howland Pump & Supply', 'https://api.test',
    )!,
    ...over,
  });

  it('an unbranded tenant gets the platform email, unchanged', () => {
    expect(toEmailBrand(DEFAULT_BRANDING, 'o1', 'Org', 'https://api.test')).toBeNull();
    expect(buildInviteEmail(invite, null)).toEqual(buildInviteEmail(invite));
    expect(buildInviteEmail(invite).html).toContain('C4 Technologies');
    expect(buildPasswordResetEmail('Dan', '123456', undefined).subject).toBe('Reset your HVAC DesignPro password');
  });

  it('a branded tenant leads, with the platform credited', () => {
    const mail = buildInviteEmail(invite, brand());
    expect(mail.html).toContain('Howland Pump');
    expect(mail.html).toContain('https://api.test/org-logos/o1?v=org-logos%2Fo1%2Fa.png');
    expect(mail.html).toContain('Powered by HVAC DesignPro');
    expect(mail.html).not.toContain('#34d399');
    expect(mail.subject).toContain('on HVAC DesignPro');
  });

  it('white-label names the platform nowhere', () => {
    const b = brand({ whiteLabel: true });
    const mail = buildInviteEmail(invite, b);
    expect(mail.html).not.toContain('HVAC DesignPro');
    expect(mail.html).not.toContain('C4 Technologies');
    expect(mail.subject).toBe('Dan invited you to join Howland Pump & Supply');
    const reset = buildPasswordResetEmail('Dan', '123456', b);
    expect(reset.subject).toBe('Reset your Howland Pump password');
    expect(reset.html).not.toContain('HVAC DesignPro');
  });

  it('escapes a hostile name and sanitises the From header', () => {
    const b = brand({ displayName: 'Evil" <x@evil.test>\r\nBcc: all@evil.test' });
    expect(buildInviteEmail(invite, b).html).not.toContain('<x@evil.test>');
    const from = applyBrandFrom({ to: 'a@b.test', subject: 's', html: 'h' }, b).from!;
    expect(from).toBe('Evil x evil.test Bcc all evil.test via HVAC DesignPro <noreply@c4tech.co>');
    expect(from).not.toMatch(/[\r\n"]/);
    // The verified sending address survives; only the display name changes.
    expect(applyBrandFrom({ to: 'a', subject: 's', html: 'h', from: 'X <invites@c4tech.co>' }, brand({ whiteLabel: true })).from)
      .toBe('Howland Pump <invites@c4tech.co>');
    expect(applyBrandFrom({ to: 'a', subject: 's', html: 'h' }, null).from).toBeUndefined();
  });

  it('re-lights any brand colour to the reference luminance', () => {
    expect(brandShade('not-a-colour', '#34d399')).toBe('#34d399');
    for (const hex of ['#0b5fa5', '#000000', '#7c3aed', '#ffffff']) {
      expect(brandShade(hex, '#34d399')).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(brandShade('#001f3f', '#34d399')).not.toBe('#001f3f');
  });
});

describe('branding — public sign-in lookup', () => {
  let branded: SeededTenant;
  let plain: SeededTenant;

  beforeAll(async () => {
    // Migrations were applied by the routes suite above (same file, same DB).
    branded = await seedTenant(db(), { slug: 'signin-branded', name: 'Signin Legal Name LLC', email: 'a@signin-branded.test', role: 'admin' });
    plain = await seedTenant(db(), { slug: 'signin-plain', name: 'Plain Org', email: 'a@signin-plain.test', role: 'admin' });
    await callJson('PUT', '/api/org/branding', { token: branded.token, body: { displayName: 'Howland Pump', primaryColor: '#0b5fa5' } });
    // Unrelated tenant state that must never leak through the public route.
    await callJson('PUT', '/api/org/nav-layout', { token: branded.token, body: { landing: 'cad' } });
  });

  it('serves a branded tenant without auth, and only its branding', async () => {
    const res = await callJson('GET', '/api/auth/tenant-branding/signin-branded');
    expect(res.status).toBe(200);
    expect(res.json.tenant.name).toBe('Howland Pump');
    expect(res.json.tenant.orgId).toBe(branded.orgId);
    expect(res.json.tenant.branding.primaryColor).toBe('#0b5fa5');
    expect(Object.keys(res.json.tenant).sort()).toEqual(['branding', 'name', 'orgId', 'slug']);
    expect(JSON.stringify(res.json)).not.toContain('Signin Legal Name LLC');
    expect(JSON.stringify(res.json)).not.toContain('navLayout');
  });

  it('answers identically for an unbranded tenant, an unknown slug and a malformed one', async () => {
    const unbranded = await callJson('GET', '/api/auth/tenant-branding/signin-plain');
    const unknown = await callJson('GET', '/api/auth/tenant-branding/no-such-tenant');
    const malformed = await callJson('GET', "/api/auth/tenant-branding/%27%20OR%201=1");
    for (const r of [unbranded, unknown, malformed]) {
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ tenant: null });
    }
    expect(plain.orgId).toBeTruthy();
  });
});

