/**
 * TENANT NAVIGATION LAYOUT — validation, role gating, tenant isolation.
 *
 * The layout is presentation only, but it is still tenant-owned state an admin
 * can write, and `PUT /api/org` can write the raw settings blob beside it. So
 * the coercion is tested against hostile input, and the one hard rule — the
 * Settings item can never be hidden — is tested at both layers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, seedTenant, callJson, type SeededTenant } from './helpers/harness';
import {
  coerceNavLayout,
  applyNavLayoutPatch,
  defaultNavLayout,
  resolveNavLayout,
  mergeNavLayoutIntoSettings,
} from '../src/utils/navLayout';

const db = () => (env as unknown as { DB: D1Database }).DB;

describe('navLayout — pure validation', () => {
  it('degrades malformed input to the default', () => {
    expect(coerceNavLayout(null)).toEqual(defaultNavLayout());
    expect(coerceNavLayout({ sidebar: 'nope', landing: 7, rails: [] })).toEqual(defaultNavLayout());
    expect(resolveNavLayout('not json')).toEqual(defaultNavLayout());
  });

  it('drops bad ids, duplicates and markup labels; keeps clean ones', () => {
    const l = coerceNavLayout({
      sidebar: [
        { id: 'cad', label: 'Drafting', hidden: false, dividerBefore: true },
        { id: 'cad', label: 'Dup' },
        { id: '../etc', label: 'x' },
        { id: 'reports', label: '<b>Reports</b>', hidden: 'yes' },
      ],
    });
    expect(l.sidebar).toEqual([
      { id: 'cad', label: 'Drafting', hidden: false, dividerBefore: true },
      { id: 'reports', label: null, hidden: false, dividerBefore: false },
    ]);
  });

  it('never lets Settings be hidden, and refuses a hidden landing page', () => {
    const l = coerceNavLayout({
      sidebar: [{ id: 'settings', hidden: true }, { id: 'aed', hidden: true }, { id: 'cad' }],
      landing: 'aed',
    });
    expect(l.sidebar!.find((i) => i.id === 'settings')!.hidden).toBe(false);
    expect(l.landing).toBeNull();
    expect(coerceNavLayout({ sidebar: [{ id: 'cad' }], landing: 'cad' }).landing).toBe('cad');
  });

  it('patches only the parts present', () => {
    const start = coerceNavLayout({ landing: 'cad', rails: { team: { mode: 'locked', hidden: ['invites'] } } });
    const { next, changed } = applyNavLayoutPatch(start, { rails: { permits: { mode: 'locked', order: ['open', 'closed'] } } });
    expect(changed).toEqual(['rails.permits']);
    expect(next.landing).toBe('cad');
    expect(next.rails.team).toEqual({ order: null, hidden: ['invites'], mode: 'locked' });
    expect(next.rails.permits).toEqual({ order: ['open', 'closed'], hidden: [], mode: 'locked' });
    expect(applyNavLayoutPatch(start, { sidebar: null }).next.sidebar).toBeNull();
    expect(applyNavLayoutPatch(start, { unrelated: 1 }).changed).toEqual([]);
  });

  it('preserves other settings keys on merge', () => {
    const merged = JSON.parse(mergeNavLayoutIntoSettings('{"branding":{"displayName":"Howland Pump"}}', defaultNavLayout()));
    expect(merged.branding).toEqual({ displayName: 'Howland Pump' });
    expect(merged.navLayout).toEqual(defaultNavLayout());
  });
});

describe('navLayout — routes', () => {
  let admin: SeededTenant;
  let other: SeededTenant;
  let viewer: SeededTenant;

  beforeAll(async () => {
    await applyMigrations(db());
    admin = await seedTenant(db(), { slug: 'nav-a', name: 'Nav A', email: 'admin@nav-a.test', role: 'admin' });
    other = await seedTenant(db(), { slug: 'nav-b', name: 'Nav B', email: 'admin@nav-b.test', role: 'admin' });
    viewer = await seedTenant(db(), { slug: 'nav-v', name: 'Nav V', email: 'viewer@nav-v.test', role: 'viewer' });
  });

  it('requires auth', async () => {
    expect((await callJson('GET', '/api/org/nav-layout')).status).toBe(401);
  });

  it('members read the default; only admins write', async () => {
    const get = await callJson('GET', '/api/org/nav-layout', { token: viewer.token });
    expect(get.status).toBe(200);
    expect(get.json.layout).toEqual(defaultNavLayout());
    expect(get.json.canEdit).toBe(false);
    expect((await callJson('PUT', '/api/org/nav-layout', { token: viewer.token, body: { landing: 'cad' } })).status).toBe(403);
  });

  it('admin saves; another tenant is unaffected; empty body is a 400', async () => {
    const put = await callJson('PUT', '/api/org/nav-layout', {
      token: admin.token,
      body: {
        sidebar: [{ id: 'cad', label: 'Drafting' }, { id: 'settings', hidden: true }, { id: 'community', hidden: true }],
        landing: 'cad',
        rails: { settings: { mode: 'locked', hidden: ['engine'] } },
      },
    });
    expect(put.status).toBe(200);
    expect(put.json.layout.sidebar[0]).toEqual({ id: 'cad', label: 'Drafting', hidden: false, dividerBefore: false });
    expect(put.json.layout.sidebar[1].hidden).toBe(false); // settings is pinned
    expect(put.json.layout.rails.settings.mode).toBe('locked');

    const mine = await callJson('GET', '/api/org/nav-layout', { token: admin.token });
    expect(mine.json.layout.landing).toBe('cad');
    const theirs = await callJson('GET', '/api/org/nav-layout', { token: other.token });
    expect(theirs.json.layout).toEqual(defaultNavLayout());

    expect((await callJson('PUT', '/api/org/nav-layout', { token: admin.token, body: {} })).status).toBe(400);
  });

  it('a later branding write does not clobber the layout', async () => {
    await callJson('PUT', '/api/org/branding', { token: admin.token, body: { displayName: 'Nav A Co' } });
    const mine = await callJson('GET', '/api/org/nav-layout', { token: admin.token });
    expect(mine.json.layout.landing).toBe('cad');
  });
});
