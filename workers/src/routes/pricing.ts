import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
}

export const pricingRoutes = new Hono<{ Bindings: Env }>();

// Every mutating endpoint is admin-only (L0 passes too). Reads (/status,
// /items) are open to any member so the estimator + retailer panel can decide
// whether real pricing exists.
function requireAdmin(user: { role: string; isPlatformAdmin: boolean }): boolean {
  return user.role === 'admin' || user.isPlatformAdmin;
}

const VALID_KINDS = new Set(['csv', 'webhook', 'api']);
const VALID_CATEGORIES = new Set(['equipment', 'ductwork', 'controls', 'labor', 'permits', 'misc']);
const VALID_SYSTEM_TYPES = new Set(['heat_pump', 'ac_furnace', 'mini_split', 'packaged']);

// ── GET /api/pricing/status — does this org have real pricing? ───────────────
// Open to any member. Drives the retailer-panel fallback message + the estimator
// (which fetches /items only when hasActivePricing). Org-scoped.
pricingRoutes.get('/status', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, name, status, item_count, updated_at
       FROM pricing_sources WHERE org_id = ? ORDER BY created_at DESC`
  ).bind(user.orgId).all();

  const sources = results as Array<Record<string, unknown>>;
  const active = sources.filter((s) => s.status === 'active');
  const itemCount = active.reduce((sum, s) => sum + Number(s.item_count ?? 0), 0);

  return c.json({
    hasActivePricing: active.length > 0 && itemCount > 0,
    sourceCount: sources.length,
    activeCount: active.length,
    itemCount,
    sources,
  });
});

// ── GET /api/pricing/items — active normalized price rows (for the estimator) ─
// Open to any member (the estimator runs client-side and needs these to
// override line items). Org-scoped; only rows from ACTIVE sources.
pricingRoutes.get('/items', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT pi.category, pi.match_key, pi.model, pi.description, pi.unit, pi.unit_price, pi.currency
       FROM pricing_items pi
       JOIN pricing_sources ps ON ps.id = pi.source_id AND ps.org_id = pi.org_id
      WHERE pi.org_id = ? AND ps.status = 'active'`
  ).bind(user.orgId).all();
  return c.json({ items: results });
});

// ── GET /api/pricing/sources — admin: full source list ──────────────────────
pricingRoutes.get('/sources', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can view pricing sources' }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, name, status, config, item_count, created_at, updated_at
       FROM pricing_sources WHERE org_id = ? ORDER BY created_at DESC`
  ).bind(user.orgId).all();
  return c.json({ sources: results });
});

// ── POST /api/pricing/sources — admin: register a webhook/api source ────────
// Phase 1 REGISTERS the endpoint (status='pending') — it does NOT execute it.
// Live oracle calls + encrypted credential storage land in the next phase; a
// pending source deliberately does not feed prices, so the fallback still
// shows until it is activated. CSV sources are created by POST /csv instead.
pricingRoutes.post('/sources', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can configure pricing' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const kind = String(body.kind ?? '');
  const name = String(body.name ?? '').trim();
  const url = String(body.url ?? '').trim();

  if (kind !== 'webhook' && kind !== 'api') {
    return c.json({ error: 'Register webhook or api sources here; upload CSVs via /csv' }, 400);
  }
  if (!name) return c.json({ error: 'A name is required' }, 400);
  if (!/^https:\/\/.+/i.test(url)) return c.json({ error: 'A valid https:// endpoint URL is required' }, 400);

  const id = generateId();
  // config holds only the non-secret endpoint. No credentials in Phase 1.
  await c.env.DB.prepare(
    `INSERT INTO pricing_sources (id, org_id, kind, name, status, config, created_by)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, user.orgId, kind, name, JSON.stringify({ url }), user.id).run();

  setAudit(c, {
    action: 'pricing.source.register',
    entityType: 'pricing_source',
    entityId: id,
    entityLabel: name,
    detail: { kind, url },
  });

  return c.json({ id, kind, name, status: 'pending', config: { url }, item_count: 0 }, 201);
});

// ── PATCH /api/pricing/sources/:id — admin: enable / disable / rename ────────
pricingRoutes.patch('/sources/:id', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can configure pricing' }, 403);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT id, kind, name, status FROM pricing_sources WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();
  if (!existing) return c.json({ error: 'Pricing source not found' }, 404);

  // A webhook/api source can't be flipped 'active' in Phase 1 — it has no live
  // execution yet, so activating it would silently feed nothing. Only CSV
  // sources (which already hold real rows) toggle active/disabled.
  const nextStatus = body.status as string | undefined;
  if (nextStatus === 'active' && existing.kind !== 'csv') {
    return c.json({ error: 'Live activation for webhook/API sources is not available yet' }, 400);
  }
  if (nextStatus && !['active', 'pending', 'disabled'].includes(nextStatus)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : (existing.name as string);
  const status = nextStatus ?? (existing.status as string);

  await c.env.DB.prepare(
    `UPDATE pricing_sources SET name = ?, status = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`
  ).bind(name, status, id, user.orgId).run();

  setAudit(c, {
    action: 'pricing.source.update',
    entityType: 'pricing_source',
    entityId: id,
    entityLabel: name,
    beforeValue: { name: existing.name, status: existing.status },
    detail: { name, status },
  });

  return c.json({ id, name, status });
});

// ── DELETE /api/pricing/sources/:id — admin: remove source + its items ──────
pricingRoutes.delete('/sources/:id', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can configure pricing' }, 403);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, name FROM pricing_sources WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();
  if (!existing) return c.json({ error: 'Pricing source not found' }, 404);

  await c.env.DB.prepare('DELETE FROM pricing_items WHERE source_id = ? AND org_id = ?').bind(id, user.orgId).run();
  await c.env.DB.prepare('DELETE FROM pricing_sources WHERE id = ? AND org_id = ?').bind(id, user.orgId).run();

  setAudit(c, {
    action: 'pricing.source.delete',
    entityType: 'pricing_source',
    entityId: id,
    entityLabel: existing.name as string,
  });

  return c.json({ ok: true });
});

// ── POST /api/pricing/csv — admin: upload a price-list CSV (LIVE) ────────────
// The one channel that is fully real this phase: parse the CSV into normalized
// pricing_items and create an ACTIVE csv source. Body: { name, csv }.
pricingRoutes.post('/csv', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can configure pricing' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim() || 'Uploaded price list';
  const csv = String(body.csv ?? '');
  if (!csv.trim()) return c.json({ error: 'No CSV content provided' }, 400);

  const { rows, errors } = parsePricingCsv(csv);
  if (rows.length === 0) {
    return c.json({ error: 'No valid price rows found in the CSV', details: errors.slice(0, 10) }, 400);
  }

  const sourceId = generateId();
  await c.env.DB.prepare(
    `INSERT INTO pricing_sources (id, org_id, kind, name, status, config, item_count, created_by)
     VALUES (?, ?, 'csv', ?, 'active', ?, ?, ?)`
  ).bind(
    sourceId, user.orgId, name,
    JSON.stringify({ rowsParsed: rows.length, rowsSkipped: errors.length }),
    rows.length, user.id,
  ).run();

  // Batch the inserts. D1 batch keeps this to one round-trip regardless of row
  // count; a distributor list is typically dozens–hundreds of rows.
  const stmt = c.env.DB.prepare(
    `INSERT INTO pricing_items
       (id, org_id, source_id, category, match_key, model, description, unit, unit_price, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = rows.map((r) =>
    stmt.bind(generateId(), user.orgId, sourceId, r.category, r.matchKey, r.model, r.description, r.unit, r.unitPrice, r.currency)
  );
  await c.env.DB.batch(batch);

  setAudit(c, {
    action: 'pricing.csv.upload',
    entityType: 'pricing_source',
    entityId: sourceId,
    entityLabel: name,
    detail: { rowsParsed: rows.length, rowsSkipped: errors.length },
  });

  return c.json({ sourceId, name, itemCount: rows.length, skipped: errors.length, errors: errors.slice(0, 10) }, 201);
});

// ── CSV parsing ──────────────────────────────────────────────────────────────
interface ParsedRow {
  category: string;
  matchKey: string;
  model: string;
  description: string;
  unit: string;
  unitPrice: number;
  currency: string;
}

/**
 * Parse a distributor price-list CSV into normalized rows. Canonical header
 * columns (case-insensitive, order-independent):
 *   category      required — equipment|ductwork|controls|labor|permits|misc
 *   unit_price    required — number (a leading $ and thousands commas are ok)
 *   system_type   optional — heat_pump|ac_furnace|mini_split|packaged
 *   tonnage       optional — number (for equipment)
 *   model         optional — brand/model/SKU
 *   description   optional
 *   unit          optional — defaults to 'each'
 *   match_key     optional — override the estimator lookup key directly
 *
 * `match_key` is what the estimator resolves per line. If not given, it's
 * derived: equipment rows with system_type+tonnage → equipment:<type>:<tons>;
 * otherwise <category>:<model|description> (lowercased), else <category>.
 */
export function parsePricingCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ['CSV needs a header row and at least one data row'] };

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const ci = {
    category: col('category'), unit_price: col('unit_price'), system_type: col('system_type'),
    tonnage: col('tonnage'), model: col('model'), description: col('description'),
    unit: col('unit'), match_key: col('match_key'), currency: col('currency'),
  };
  if (ci.category < 0 || ci.unit_price < 0) {
    return { rows: [], errors: ['CSV must have at least "category" and "unit_price" columns'] };
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const at = (idx: number) => (idx >= 0 && idx < f.length ? f[idx].trim() : '');

    const category = at(ci.category).toLowerCase();
    if (!VALID_CATEGORIES.has(category)) { errors.push(`Row ${i + 1}: unknown category "${at(ci.category)}"`); continue; }

    const priceRaw = at(ci.unit_price).replace(/[$,]/g, '');
    const unitPrice = Number(priceRaw);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) { errors.push(`Row ${i + 1}: invalid unit_price "${at(ci.unit_price)}"`); continue; }

    const systemType = at(ci.system_type).toLowerCase();
    const tonnage = at(ci.tonnage);
    const model = at(ci.model);
    const description = at(ci.description);
    const unit = at(ci.unit) || 'each';
    const currency = (at(ci.currency) || 'USD').toUpperCase().slice(0, 3);

    let matchKey = at(ci.match_key).toLowerCase();
    if (!matchKey) {
      if (category === 'equipment' && VALID_SYSTEM_TYPES.has(systemType) && tonnage) {
        const tons = Number(tonnage);
        matchKey = Number.isFinite(tons) ? `equipment:${systemType}:${tons}` : `equipment:${systemType}`;
      } else {
        const tail = (model || description).toLowerCase().trim();
        matchKey = tail ? `${category}:${tail}` : category;
      }
    }

    rows.push({ category, matchKey, model, description, unit, unitPrice, currency });
  }
  return { rows, errors };
}

/** Minimal CSV line splitter — handles double-quoted fields with embedded
 *  commas and escaped ("") quotes. Enough for distributor exports. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else { cur += ch; }
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}
