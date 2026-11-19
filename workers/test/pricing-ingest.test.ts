/**
 * PRICING INBOUND FEED — Worker integration tests (real worker, real D1, real
 * sessions; nothing mocked). Covers the DDI Inform push path end to end:
 *
 *   admin registers an inbound source (+ categoryMap) → issues a token →
 *   supplier POSTs /api/pricing/ingest/:id with `Authorization: Bearer` →
 *   rows land org-scoped, the source flips active, the estimator feed
 *   (/api/pricing/items) sees them — and ONLY that org sees them.
 *
 * Security properties locked down here:
 *   - unknown source / no token issued / wrong token → identical 401
 *   - a valid token for org A's source cannot touch org B (ids are per-source;
 *     the org is derived from the matched row, never from the request)
 *   - the admin kill switch (status=disabled) actually refuses the feed (409)
 *   - rotating the token invalidates the old one immediately
 *   - only admins issue tokens (viewer → 403); the hash is never returned
 *   - dryRun validates without writing
 *   - api (pull) sources still cannot be activated (no executor yet)
 *
 * NOTE: like every harness suite, this runs green in CI (Linux) and fails at
 * import on Windows (workerd + path-with-space) — see memory. Not a code bug.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, seedTenant, callJson, type SeededTenant } from './helpers/harness';

const db = () => (env as unknown as { DB: D1Database }).DB;

let adminA: SeededTenant;
let adminB: SeededTenant;
let viewerC: SeededTenant;
let sourceId = '';
let token = '';

/** A DDI-shaped price book: canonical names, ERP aliases, a product group
 *  that needs the categoryMap, and one row that must be rejected. */
const FEED = {
  items: [
    { category: 'equipment', system_type: 'heat_pump', tonnage: 3, model: 'DDI-HP36', description: '3-ton heat pump', unit_price: 4850 },
    { productGroup: 'HP-COND', equipmentType: 'heat_pump', tons: '3.5', itemNumber: 'DDI-HP42', price: '$5,400.00', uom: 'EA' },
    { category: 'controls', match_key: 'controls:thermostat', model: 'ECO-PREM', price: 245 },
    { category: 'misc', match_key: 'misc:filter', model: 'BAD-ROW', unit_price: 0 },
  ],
};

beforeAll(async () => {
  await applyMigrations(db());
  adminA = await seedTenant(db(), { slug: 'pi-a', name: 'Pricing Org A', email: 'admin@pi-a.test', role: 'admin' });
  adminB = await seedTenant(db(), { slug: 'pi-b', name: 'Pricing Org B', email: 'admin@pi-b.test', role: 'admin' });
  viewerC = await seedTenant(db(), { slug: 'pi-c', name: 'Pricing Org C', email: 'viewer@pi-c.test', role: 'viewer' });
});

describe('inbound feed — registration + token', () => {
  it('admin registers an inbound source with a categoryMap (no URL needed)', async () => {
    const { status, json } = await callJson('POST', '/api/pricing/sources', {
      token: adminA.token,
      body: { kind: 'webhook', name: 'DDI Inform', categoryMap: { 'HP-COND': 'equipment', junk: 'not-a-category' } },
    });
    expect(status).toBe(201);
    expect(json.status).toBe('pending');
    expect(json.has_ingest_token).toBe(0);
    expect(json.config.categoryMap).toEqual({ 'hp-cond': 'equipment' }); // lowercased, invalid value dropped
    sourceId = json.id;
  });

  it('an api (pull) source still requires an https URL', async () => {
    const { status } = await callJson('POST', '/api/pricing/sources', { token: adminA.token, body: { kind: 'api', name: 'Pull' } });
    expect(status).toBe(400);
  });

  it('viewer cannot issue a token (403)', async () => {
    const { status } = await callJson('POST', `/api/pricing/sources/${sourceId}/token`, { token: viewerC.token });
    expect(status).toBe(403);
  });

  it("org B admin cannot issue a token for org A's source (404 — not visible)", async () => {
    const { status } = await callJson('POST', `/api/pricing/sources/${sourceId}/token`, { token: adminB.token });
    expect(status).toBe(404);
  });

  it('org A admin issues the token — plaintext returned once, hash never exposed', async () => {
    const { status, json } = await callJson('POST', `/api/pricing/sources/${sourceId}/token`, { token: adminA.token });
    expect(status).toBe(201);
    expect(typeof json.token).toBe('string');
    expect(json.token.length).toBeGreaterThan(60);
    expect(json.ingestPath).toBe(`/api/pricing/ingest/${sourceId}`);
    token = json.token;

    const list = await callJson('GET', '/api/pricing/sources', { token: adminA.token });
    const row = list.json.sources.find((s: { id: string }) => s.id === sourceId);
    expect(row.has_ingest_token).toBe(1);
    expect(row.ingest_token_hash).toBeUndefined();
  });
});

describe('inbound feed — POST /api/pricing/ingest/:sourceId (public, token-authed)', () => {
  it('no token → 401', async () => {
    const { status } = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { body: FEED });
    expect(status).toBe(401);
  });

  it('wrong token → 401, unknown source → 401 (indistinguishable)', async () => {
    const wrong = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token: 'not-the-token', body: FEED });
    const unknown = await callJson('POST', `/api/pricing/ingest/does-not-exist`, { token, body: FEED });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);
  });

  it('a rejected push on a known feed is audited for that org (no token material)', async () => {
    const rows = await db().prepare(
      `SELECT detail FROM audit_log WHERE org_id = ? AND action = 'pricing.ingest' AND status_code = 401`,
    ).bind(adminA.orgId).all();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const r of rows.results as Array<{ detail: string }>) {
      expect(r.detail).toContain('invalid_token');
      expect(r.detail).not.toContain('not-the-token');
    }
  });

  it('dryRun validates the payload and reports keys, but writes nothing', async () => {
    const { status, json } = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: { ...FEED, dryRun: true } });
    expect(status).toBe(200);
    expect(json.dryRun).toBe(true);
    expect(json.loaded).toBe(3);
    expect(json.skipped).toBe(1);
    expect(json.errors[0]).toBe('Item 4: unit_price must be greater than 0');
    expect(json.matchKeys.sort()).toEqual(['controls:thermostat', 'equipment:heat_pump:3', 'equipment:heat_pump:3.5']);
    expect(json.status).toBe('pending');

    const st = await callJson('GET', '/api/pricing/status', { token: adminA.token });
    expect(st.json.hasActivePricing).toBe(false);
    expect(st.json.itemCount).toBe(0);
  });

  it('a real push loads the rows, activates the source, and feeds the estimator for org A only', async () => {
    const { status, json } = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: FEED });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.loaded).toBe(3);
    expect(json.status).toBe('active');
    expect(json.org_id).toBeUndefined(); // never echoed

    const itemsA = await callJson('GET', '/api/pricing/items', { token: adminA.token });
    expect(itemsA.json.items).toHaveLength(3);
    const hp42 = itemsA.json.items.find((i: { model: string }) => i.model === 'DDI-HP42');
    expect(hp42.match_key).toBe('equipment:heat_pump:3.5');
    expect(hp42.unit_price).toBe(5400);
    expect(hp42.category).toBe('equipment'); // via categoryMap

    const stA = await callJson('GET', '/api/pricing/status', { token: adminA.token });
    expect(stA.json.hasActivePricing).toBe(true);
    expect(stA.json.itemCount).toBe(3);

    // Org B: nothing leaks.
    const itemsB = await callJson('GET', '/api/pricing/items', { token: adminB.token });
    expect(itemsB.json.items).toHaveLength(0);
    const stB = await callJson('GET', '/api/pricing/status', { token: adminB.token });
    expect(stB.json.hasActivePricing).toBe(false);

    // Last-feed bookkeeping surfaced to the admin list.
    const list = await callJson('GET', '/api/pricing/sources', { token: adminA.token });
    const row = list.json.sources.find((s: { id: string }) => s.id === sourceId);
    expect(row.status).toBe('active');
    expect(row.item_count).toBe(3);
    expect(row.last_ingest_at).toBeTruthy();
    expect(JSON.parse(row.last_ingest_summary)).toMatchObject({ loaded: 3, skipped: 1 });
  });

  it('a second push REPLACES the book (no stale rows survive)', async () => {
    const { status, json } = await callJson('POST', `/api/pricing/ingest/${sourceId}`, {
      token, body: { items: [{ category: 'misc', match_key: 'misc:lineset', model: 'LS-25', unit_price: 185 }] },
    });
    expect(status).toBe(200);
    expect(json.loaded).toBe(1);
    const items = await callJson('GET', '/api/pricing/items', { token: adminA.token });
    expect(items.json.items).toHaveLength(1);
    expect(items.json.items[0].match_key).toBe('misc:lineset');
  });

  it('a payload with zero valid rows → 400 with the row errors, and the previous book is untouched', async () => {
    const { status, json } = await callJson('POST', `/api/pricing/ingest/${sourceId}`, {
      token, body: { items: [{ category: 'misc', unit_price: '' }] },
    });
    expect(status).toBe(400);
    expect(json.details[0]).toBe('Item 1: missing unit_price');
    const items = await callJson('GET', '/api/pricing/items', { token: adminA.token });
    expect(items.json.items).toHaveLength(1);
  });

  it('malformed bodies → 400; an oversized item list → 413', async () => {
    const notArray = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: { items: 'nope' } });
    expect(notArray.status).toBe(400);
    const empty = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: { items: [] } });
    expect(empty.status).toBe(400);
    const huge = await callJson('POST', `/api/pricing/ingest/${sourceId}`, {
      token, body: { items: Array.from({ length: 1001 }, () => ({ category: 'misc', unit_price: 1 })) },
    });
    expect(huge.status).toBe(413);
  });

  it('the admin kill switch really stops the feed: disabled → 409, re-enabled → 200', async () => {
    const off = await callJson('PATCH', `/api/pricing/sources/${sourceId}`, { token: adminA.token, body: { status: 'disabled' } });
    expect(off.status).toBe(200);
    const refused = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: FEED });
    expect(refused.status).toBe(409);
    const st = await callJson('GET', '/api/pricing/status', { token: adminA.token });
    expect(st.json.hasActivePricing).toBe(false);

    // Re-activation is allowed because the feed already holds rows.
    const on = await callJson('PATCH', `/api/pricing/sources/${sourceId}`, { token: adminA.token, body: { status: 'active' } });
    expect(on.status).toBe(200);
    const ok = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: FEED });
    expect(ok.status).toBe(200);
  });

  it('rotating the token invalidates the old one immediately', async () => {
    const rot = await callJson('POST', `/api/pricing/sources/${sourceId}/token`, { token: adminA.token });
    expect(rot.status).toBe(201);
    const stale = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: FEED });
    expect(stale.status).toBe(401);
    token = rot.json.token;
    const fresh = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: FEED });
    expect(fresh.status).toBe(200);
  });
});

describe('admin manual push — POST /api/pricing/sources/:id/ingest', () => {
  it("org B admin cannot push into org A's source (404)", async () => {
    const { status } = await callJson('POST', `/api/pricing/sources/${sourceId}/ingest`, { token: adminB.token, body: FEED });
    expect(status).toBe(404);
  });

  it('org A admin dry-runs through the same normalizer', async () => {
    const { status, json } = await callJson('POST', `/api/pricing/sources/${sourceId}/ingest`, { token: adminA.token, body: { ...FEED, dryRun: true } });
    expect(status).toBe(200);
    expect(json.dryRun).toBe(true);
    expect(json.loaded).toBe(3);
  });

  it('a fresh inbound source cannot be activated by hand before its first push', async () => {
    const created = await callJson('POST', '/api/pricing/sources', { token: adminA.token, body: { kind: 'webhook', name: 'Empty feed' } });
    const { status } = await callJson('PATCH', `/api/pricing/sources/${created.json.id}`, { token: adminA.token, body: { status: 'active' } });
    expect(status).toBe(400);
  });

  it('api (pull) sources register but still cannot be activated (no executor yet)', async () => {
    const created = await callJson('POST', '/api/pricing/sources', {
      token: adminA.token, body: { kind: 'api', name: 'Inform pull', url: 'https://inform.example/api/price' },
    });
    expect(created.status).toBe(201);
    const { status } = await callJson('PATCH', `/api/pricing/sources/${created.json.id}`, { token: adminA.token, body: { status: 'active' } });
    expect(status).toBe(400);
    // …and it has no ingest token to issue.
    const tok = await callJson('POST', `/api/pricing/sources/${created.json.id}/token`, { token: adminA.token });
    expect(tok.status).toBe(400);
  });

  it('deleting the source removes its rows and the feed goes dark', async () => {
    const del = await callJson('DELETE', `/api/pricing/sources/${sourceId}`, { token: adminA.token });
    expect(del.status).toBe(200);
    const items = await callJson('GET', '/api/pricing/items', { token: adminA.token });
    expect(items.json.items).toHaveLength(0);
    const gone = await callJson('POST', `/api/pricing/ingest/${sourceId}`, { token, body: FEED });
    expect(gone.status).toBe(401);
  });
});
