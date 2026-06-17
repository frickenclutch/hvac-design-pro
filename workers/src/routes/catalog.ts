import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';
import { roleSatisfies } from '../utils/accessPolicy';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export const catalogRoutes = new Hono<{ Bindings: Env }>();

// ── Shared validation domains ────────────────────────────────────────────────
// `category` and `equipment_type` mirror the migration 0013 CHECK list and the
// Manual S engine's own discriminator values, so the row → engine mapper is a
// near-identity field copy on the frontend.
const CATEGORIES = ['hvac_equipment', 'water_heater', 'pipe_fitting', 'other'] as const;
type Category = (typeof CATEGORIES)[number];
const EQUIPMENT_TYPES = ['ac', 'heat_pump', 'furnace_gas', 'furnace_electric'] as const;
type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

/** Coerce an untrusted body value to a finite integer, else a default —
 *  so a malformed ERP/admin feed can't bind NaN into a numeric column. */
function intOr(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ / SEARCH — GET /api/catalog
//
// Any authenticated org member (viewer+) may read their org's inventory —
// reading the catalog is not a privileged action. Every query is org-scoped by
// the SESSION-derived org (user.orgId); a client-supplied org_id is never read.
// ─────────────────────────────────────────────────────────────────────────────
catalogRoutes.get('/', async (c) => {
  const user = c.get('user'); // session-derived; NEVER from body/query

  const url = new URL(c.req.url);
  const category = url.searchParams.get('category');
  if (category && !CATEGORIES.includes(category as Category)) {
    return c.json({ error: 'Invalid category' }, 400);
  }
  const q = (url.searchParams.get('q') || '').trim();
  const activeOnly = url.searchParams.get('activeOnly') === '1';
  let limit = parseInt(url.searchParams.get('limit') || '50', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  // org_id is the session-derived tenant gate and is bound first.
  const extra: string[] = [];
  const binds: unknown[] = [user.orgId];
  if (category) { extra.push('category = ?'); binds.push(category); }
  if (activeOnly) { extra.push('active = 1'); }
  if (q) {
    extra.push('(sku LIKE ? OR name LIKE ? OR brand LIKE ? OR model LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  binds.push(limit);

  // `org_id = ?` is a LITERAL first predicate (not interpolated) so the static
  // tenant-scoping guard machine-enforces it — a future regression on this query
  // fails the build, not just the runtime isolation test. Only the optional
  // filters are interpolated. user.orgId is the session org; no client org_id.
  const extraSql = extra.length ? ` AND ${extra.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM catalog_products WHERE org_id = ?${extraSql}
     ORDER BY name COLLATE NOCASE ASC LIMIT ?`,
  ).bind(...binds).all();

  return c.json({ items: results ?? [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// INGESTION — POST /api/catalog/items  (bulk-upsert, idempotent)
//
// Body: { items: BulkCatalogItemInput[] }  (1..500 per call). Idempotent on
// (org_id, sku) — re-pushing the same SKU updates the row in place; the id and
// created_at are preserved, updated_at is bumped.
//
// ── AUTH GATE ────────────────────────────────────────────────────────────────
// v1: admin-session-gated (roleSatisfies admin; L0 always passes).
//
// FUTURE SERVICE-TOKEN SEAM:
// When the org's ERP/inventory feed pushes via an API key, a service-token
// principal will be resolved upstream in authMiddleware and land in
// c.get('user') with role='service' (or a dedicated flag) + the SAME orgId.
// The org-scope stamping below is identical for a human admin or a service
// token — org_id is always user.orgId, never client-supplied — so the ONLY
// change needed then is to broaden THIS gate to also accept the service
// principal. No data-path change. The seam is: this gate + authMiddleware.
// ─────────────────────────────────────────────────────────────────────────────
catalogRoutes.post('/items', async (c) => {
  const user = c.get('user');

  if (!roleSatisfies(user.role, 'admin', user.isPlatformAdmin)) {
    return c.json({ error: 'Admin role required' }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null;
  const items = Array.isArray(body?.items) ? (body!.items as unknown[]) : null;
  if (!items || items.length === 0) return c.json({ error: 'items required' }, 400);
  if (items.length > 500) return c.json({ error: 'Max 500 items per call' }, 400);

  let createdCount = 0;
  let updatedCount = 0;

  for (const raw of items as Array<Record<string, unknown>>) {
    const sku = String(raw.sku ?? '').trim();
    const name = String(raw.name ?? '').trim();
    if (!sku || !name) return c.json({ error: 'Each item requires sku and name' }, 400);

    const category = (raw.category as string | undefined) ?? 'other';
    if (!CATEGORIES.includes(category as Category)) {
      return c.json({ error: `Invalid category: ${category}` }, 400);
    }
    const equipmentType = raw.equipmentType as string | undefined;
    if (equipmentType && !EQUIPMENT_TYPES.includes(equipmentType as EquipmentType)) {
      return c.json({ error: `Invalid equipmentType: ${equipmentType}` }, 400);
    }

    // Detect create-vs-update for the count — ORG-SCOPED existence check, so a
    // SKU another tenant owns is invisible here (and the unique index is
    // (org_id, sku), so the upsert can only ever touch this org's row).
    const existing = await c.env.DB.prepare(
      'SELECT id FROM catalog_products WHERE org_id = ? AND sku = ?',
    ).bind(user.orgId, sku).first<{ id: string }>();

    const id = existing?.id ?? generateId();
    if (existing) updatedCount++; else createdCount++;

    // org_id is bound from the session; ON CONFLICT (org_id, sku) keeps it
    // idempotent and per-tenant. org_id is intentionally NOT in the DO UPDATE
    // SET — a conflicting row already belongs to this org by construction.
    await c.env.DB.prepare(
      `INSERT INTO catalog_products
         (id, org_id, category, sku, name, brand, model, description,
          price_minor, currency, stock_qty, unit, active, metadata,
          equipment_type, total_cooling_btu, sensible_cooling_btu, ahri_ref,
          heating_btu, heating_cap_47, heating_cap_17, afue,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               datetime('now'), datetime('now'))
       ON CONFLICT (org_id, sku) DO UPDATE SET
         category    = excluded.category,
         name        = excluded.name,
         brand       = excluded.brand,
         model       = excluded.model,
         description = excluded.description,
         price_minor = excluded.price_minor,
         currency    = excluded.currency,
         stock_qty   = excluded.stock_qty,
         unit        = excluded.unit,
         active      = excluded.active,
         metadata    = excluded.metadata,
         equipment_type       = excluded.equipment_type,
         total_cooling_btu    = excluded.total_cooling_btu,
         sensible_cooling_btu = excluded.sensible_cooling_btu,
         ahri_ref             = excluded.ahri_ref,
         heating_btu          = excluded.heating_btu,
         heating_cap_47       = excluded.heating_cap_47,
         heating_cap_17       = excluded.heating_cap_17,
         afue                 = excluded.afue,
         updated_at = datetime('now')`,
    ).bind(
      id, user.orgId, category, sku, name,
      raw.brand ?? null, raw.model ?? null, raw.description ?? null,
      intOr(raw.priceMinor, 0), String(raw.currency ?? 'USD'),
      intOr(raw.stockQty, 0), String(raw.unit ?? 'each'),
      raw.active === false ? 0 : 1,
      raw.metadata ? JSON.stringify(raw.metadata) : null,
      equipmentType ?? null,
      raw.totalCoolingBtu ?? null, raw.sensibleCoolingBtu ?? null, raw.ahriRef ?? null,
      raw.heatingBtu ?? null, raw.heatingCap47 ?? null, raw.heatingCap17 ?? null,
      raw.afue ?? null,
    ).run();
  }

  setAudit(c, {
    action: 'catalog.bulk_upsert',
    entityType: 'catalog_products',
    entityLabel: `${items.length} item(s)`,
    detail: { upsertedCount: items.length, createdCount, updatedCount },
  });

  return c.json({ upsertedCount: items.length, createdCount, updatedCount });
});
