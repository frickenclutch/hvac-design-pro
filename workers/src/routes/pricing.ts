import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';
import { hashToken, timingSafeEqual } from '../utils/crypto';

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

const VALID_CATEGORIES = new Set(['equipment', 'ductwork', 'controls', 'labor', 'permits', 'misc']);
const VALID_SYSTEM_TYPES = new Set(['heat_pump', 'ac_furnace', 'mini_split', 'packaged']);

/** Inbound-feed limits. A distributor price book relevant to the estimator is
 *  dozens of rows (≈17 match keys × a few tonnages); 1,000 leaves ample
 *  headroom while keeping one feed inside a bounded number of D1 batches. */
export const MAX_INGEST_ITEMS = 1000;
const MAX_INGEST_BYTES = 2_000_000;
/** Statements per D1 batch() call. Each batch is one transaction, so a feed of
 *  ≤ ~98 rows (the realistic case) lands atomically with its DELETE. Larger
 *  feeds span batches; a failure mid-way leaves a partial book that the next
 *  push (replace semantics) heals. */
const BATCH_CHUNK = 100;

// ── Source config (non-secret JSON on pricing_sources.config) ────────────────
interface SourceConfig {
  /** Supplier endpoint for kind='api' (we would poll it — not executed yet). */
  url?: string;
  /** Supplier product-group / item-class → our category. Lets a DDI export
   *  say "HP-COND" and still bucket as `equipment`. Keys lowercased. */
  categoryMap?: Record<string, string>;
  rowsParsed?: number;
  rowsSkipped?: number;
}

function parseConfig(raw: unknown): SourceConfig {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as SourceConfig) : {};
  } catch {
    return {};
  }
}

/** Coerce an untrusted categoryMap body value: lowercased keys, values limited
 *  to our category set, bounded size. Anything else is dropped, not stored. */
function sanitizeCategoryMap(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = String(k).trim().toLowerCase().slice(0, 64);
    const val = String(v ?? '').trim().toLowerCase();
    if (!key || !VALID_CATEGORIES.has(val)) continue;
    out[key] = val;
    if (++n >= 200) break;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ── GET /api/pricing/status — does this org have real pricing? ───────────────
// Open to any member. Drives the retailer-panel fallback message + the estimator
// (which fetches /items only when hasActivePricing). Org-scoped.
pricingRoutes.get('/status', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, name, status, item_count, last_ingest_at, updated_at
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
// Never returns ingest_token_hash — only whether a token exists.
pricingRoutes.get('/sources', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can view pricing sources' }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, name, status, config, item_count, created_at, updated_at,
            last_ingest_at, last_ingest_summary,
            CASE WHEN ingest_token_hash IS NULL THEN 0 ELSE 1 END AS has_ingest_token
       FROM pricing_sources WHERE org_id = ? ORDER BY created_at DESC`
  ).bind(user.orgId).all();
  return c.json({ sources: results });
});

// ── POST /api/pricing/sources — admin: register an inbound feed or api source ─
// kind='webhook' is an INBOUND feed: we issue the endpoint + token (see
// /sources/:id/token) and the supplier pushes to us — no URL needed. It goes
// live on its first successful feed.
// kind='api' is the supplier's endpoint we would poll. Registered only —
// live pull + encrypted credential storage land in a later phase, so it
// stays 'pending' and deliberately feeds nothing.
// CSV sources are created by POST /csv instead.
pricingRoutes.post('/sources', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can configure pricing' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const kind = String(body.kind ?? '');
  const name = String(body.name ?? '').trim().slice(0, 120);
  const url = String(body.url ?? '').trim();

  if (kind !== 'webhook' && kind !== 'api') {
    return c.json({ error: 'Register inbound (webhook) or api sources here; upload CSVs via /csv' }, 400);
  }
  if (!name) return c.json({ error: 'A name is required' }, 400);
  if (kind === 'api' && !/^https:\/\/.+/i.test(url)) {
    return c.json({ error: 'A valid https:// endpoint URL is required for API sources' }, 400);
  }
  if (url && !/^https:\/\/.+/i.test(url)) return c.json({ error: 'Endpoint URL must be https://' }, 400);

  const categoryMap = sanitizeCategoryMap(body.categoryMap);
  // config holds only NON-secret settings. Credentials never live here.
  const config: SourceConfig = {};
  if (url) config.url = url;
  if (categoryMap) config.categoryMap = categoryMap;

  const id = generateId();
  await c.env.DB.prepare(
    `INSERT INTO pricing_sources (id, org_id, kind, name, status, config, created_by)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, user.orgId, kind, name, JSON.stringify(config), user.id).run();

  setAudit(c, {
    action: 'pricing.source.register',
    entityType: 'pricing_source',
    entityId: id,
    entityLabel: name,
    detail: { kind, url: url || null, categoryMapKeys: categoryMap ? Object.keys(categoryMap).length : 0 },
  });

  return c.json({ id, kind, name, status: 'pending', config, item_count: 0, has_ingest_token: 0 }, 201);
});

// ── PATCH /api/pricing/sources/:id — admin: enable / disable / rename / map ──
pricingRoutes.patch('/sources/:id', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can configure pricing' }, 403);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT id, kind, name, status, config, item_count FROM pricing_sources WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();
  if (!existing) return c.json({ error: 'Pricing source not found' }, 404);

  const nextStatus = body.status as string | undefined;
  if (nextStatus && !['active', 'pending', 'disabled'].includes(nextStatus)) {
    return c.json({ error: 'Invalid status' }, 400);
  }
  if (nextStatus === 'active') {
    // An api (pull) source has no live execution yet — activating it would
    // silently feed nothing. An inbound feed can be (re)activated only once it
    // has actually received rows; before that there is nothing to feed.
    if (existing.kind === 'api') {
      return c.json({ error: 'Live activation for REST API pull sources is not available yet' }, 400);
    }
    if (existing.kind === 'webhook' && Number(existing.item_count ?? 0) === 0) {
      return c.json({ error: 'This feed has not received any prices yet — it activates on its first successful push' }, 400);
    }
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : (existing.name as string);
  const status = nextStatus ?? (existing.status as string);
  let config = parseConfig(existing.config);
  if (body.categoryMap !== undefined) {
    const cm = sanitizeCategoryMap(body.categoryMap);
    config = { ...config };
    if (cm) config.categoryMap = cm; else delete config.categoryMap;
  }

  await c.env.DB.prepare(
    `UPDATE pricing_sources SET name = ?, status = ?, config = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`
  ).bind(name, status, JSON.stringify(config), id, user.orgId).run();

  setAudit(c, {
    action: 'pricing.source.update',
    entityType: 'pricing_source',
    entityId: id,
    entityLabel: name,
    beforeValue: { name: existing.name, status: existing.status },
    detail: { name, status, categoryMapKeys: config.categoryMap ? Object.keys(config.categoryMap).length : 0 },
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

// ── POST /api/pricing/sources/:id/token — admin: issue / rotate the feed token ─
// The plaintext is returned ONCE and stored only as a SHA-256 hash (same model
// as session tokens). Rotating invalidates the previous token immediately.
pricingRoutes.post('/sources/:id/token', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can configure pricing' }, 403);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, kind, name, ingest_token_hash FROM pricing_sources WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();
  if (!existing) return c.json({ error: 'Pricing source not found' }, 404);
  if (existing.kind !== 'webhook') {
    return c.json({ error: 'Only inbound feed sources use an ingest token' }, 400);
  }

  // Two concatenated UUIDs — the same high-entropy shape as session tokens.
  const token = `${generateId()}-${generateId()}`;
  const hash = await hashToken(token);
  await c.env.DB.prepare(
    `UPDATE pricing_sources SET ingest_token_hash = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`
  ).bind(hash, id, user.orgId).run();

  setAudit(c, {
    action: 'pricing.source.token_rotate',
    entityType: 'pricing_source',
    entityId: id,
    entityLabel: existing.name as string,
    detail: { rotated: !!existing.ingest_token_hash },
  });

  return c.json({ token, sourceId: id, ingestPath: `/api/pricing/ingest/${id}` }, 201);
});

// ── POST /api/pricing/sources/:id/ingest — admin: push a JSON price book ─────
// Session-authed twin of the public inbound endpoint: same body, same
// normalizer, same replace semantics. Lets an admin validate a payload
// (dryRun) or load one by hand, and is the seam where a future pull executor
// (kind='api') will land rows. CSV sources re-upload via /csv instead.
pricingRoutes.post('/sources/:id/ingest', async (c) => {
  const user = c.get('user');
  if (!requireAdmin(user)) return c.json({ error: 'Only admins can configure pricing' }, 403);
  const id = c.req.param('id');

  const lenHeader = Number(c.req.header('content-length') ?? 0);
  if (lenHeader > MAX_INGEST_BYTES) return c.json({ error: 'Payload too large (max 2 MB)' }, 413);
  const text = await c.req.text();
  if (text.length > MAX_INGEST_BYTES) return c.json({ error: 'Payload too large (max 2 MB)' }, 413);
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return c.json({ error: 'Body must be valid JSON' }, 400); }

  const source = await c.env.DB.prepare(
    'SELECT id, org_id, kind, name, status, config FROM pricing_sources WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first<SourceRow>();
  if (!source) return c.json({ error: 'Pricing source not found' }, 404);
  if (source.kind === 'csv') return c.json({ error: 'CSV sources are refreshed by uploading a new CSV' }, 400);

  const result = await ingestIntoSource(c.env.DB, source, payload);
  setAudit(c, {
    action: 'pricing.ingest.manual',
    entityType: 'pricing_source',
    entityId: id,
    entityLabel: source.name,
    detail: result.ok
      ? { loaded: result.outcome.loaded, skipped: result.outcome.skipped, dryRun: result.outcome.dryRun }
      : { error: result.error },
  });
  if (!result.ok) return c.json({ error: result.error, details: result.details }, result.code);
  return c.json({ ok: true, sourceId: id, ...result.outcome, status: result.status });
});

// ── POST /api/pricing/csv — admin: upload a price-list CSV (LIVE) ────────────
// Parse the CSV into normalized pricing_items and create an ACTIVE csv source.
// Body: { name, csv }.
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

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC INBOUND FEED — POST /api/pricing/ingest/:sourceId
// Mounted in index.ts AHEAD of authMiddleware (server-to-server; there is no
// user session). Auth is the per-source bearer token, compared by hash in
// constant time. The tenant is DERIVED from the matched pricing_sources row —
// nothing in the request names an org, and the org id is never echoed.
// ═════════════════════════════════════════════════════════════════════════════
export const pricingIngestPublic = new Hono<{ Bindings: Env }>();

interface SourceRow {
  id: string;
  org_id: string;
  kind: string;
  name: string;
  status: string;
  config: string | null;
  ingest_token_hash?: string | null;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

pricingIngestPublic.post('/:sourceId', async (c) => {
  const started = Date.now();
  const path = new URL(c.req.url).pathname;
  const sourceId = c.req.param('sourceId');
  const presented = bearerToken(c.req.header('authorization')) ?? c.req.header('x-ingest-token')?.trim() ?? '';
  if (!presented || !sourceId) return c.json({ error: 'Missing ingest token' }, 401);

  // tenant-scope-ok: this lookup IS the trust boundary. The row is selected by
  // its globally-unique id and accepted only if the presented token's hash
  // matches the stored hash; org_id is then DERIVED from the row for every
  // query that follows — the request carries nothing tenant-identifying.
  const src = await c.env.DB.prepare(
    `SELECT id, org_id, kind, name, status, config, ingest_token_hash
       FROM pricing_sources WHERE id = ? AND kind = 'webhook'`
  ).bind(sourceId).first<SourceRow>();

  // Always hash (constant work whether or not the source exists), then compare
  // in constant time. Unknown source, no token issued, and wrong token all
  // yield the same 401 — no enumeration signal.
  const presentedHash = await hashToken(presented);
  const storedHash = src?.ingest_token_hash ?? '';
  if (!src || !storedHash || !timingSafeEqual(presentedHash, storedHash)) {
    if (src) {
      // A known feed hit with a bad credential is a security signal for that
      // org's operators — audit it (no token material is ever logged).
      await auditInboundIngest(c.env.DB, {
        orgId: src.org_id, sourceId: src.id, path, statusCode: 401,
        durationMs: Date.now() - started, detail: { rejected: 'invalid_token' },
      });
    }
    return c.json({ error: 'Invalid ingest token' }, 401);
  }

  const lenHeader = Number(c.req.header('content-length') ?? 0);
  if (lenHeader > MAX_INGEST_BYTES) return c.json({ error: 'Payload too large (max 2 MB)' }, 413);
  const text = await c.req.text();
  if (text.length > MAX_INGEST_BYTES) return c.json({ error: 'Payload too large (max 2 MB)' }, 413);
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return c.json({ error: 'Body must be valid JSON' }, 400); }

  const result = await ingestIntoSource(c.env.DB, src, payload);
  await auditInboundIngest(c.env.DB, {
    orgId: src.org_id, sourceId: src.id, path,
    statusCode: result.ok ? 200 : result.code,
    durationMs: Date.now() - started,
    detail: result.ok
      ? { loaded: result.outcome.loaded, skipped: result.outcome.skipped, dryRun: result.outcome.dryRun }
      : { error: result.error },
  });
  if (!result.ok) return c.json({ error: result.error, details: result.details }, result.code);
  return c.json({ ok: true, sourceId: src.id, ...result.outcome, status: result.status });
});

/** Direct audit_log write — the public route runs OUTSIDE auditMiddleware (no
 *  session, no pending-audit context), so it mirrors what setAudit() would
 *  produce, the same way the cron sweeps do. user_id is NULL: the actor is the
 *  supplier's system, attributed via the source id. */
async function auditInboundIngest(
  db: D1Database,
  a: { orgId: string; sourceId: string; path: string; statusCode: number; durationMs: number; detail: Record<string, unknown> },
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO audit_log
         (id, org_id, user_id, action, entity_type, entity_id, detail, method, path, status_code, duration_ms)
       VALUES (?, ?, NULL, 'pricing.ingest', 'pricing_source', ?, ?, 'POST', ?, ?, ?)`
    ).bind(
      generateId(), a.orgId, a.sourceId,
      JSON.stringify({ ...a.detail, automated: true, source: 'inbound_feed' }),
      a.path, a.statusCode, a.durationMs,
    ).run();
  } catch (e) {
    console.error('[pricing] audit write failed for inbound ingest', a.sourceId, e);
  }
}

// ── Ingest core (shared by the public feed + the admin manual push) ─────────
export interface IngestOutcome {
  loaded: number;
  skipped: number;
  errors: string[];
  dryRun: boolean;
  /** Distinct estimator keys the payload will feed — lets an integrator see at
   *  a glance which quote lines their book covers. */
  matchKeys: string[];
}

export type IngestResult =
  | { ok: true; outcome: IngestOutcome; status: string }
  | { ok: false; code: 400 | 409 | 413; error: string; details?: string[] };

/**
 * Validate a `{ items, dryRun? }` payload against a source and, unless dryRun,
 * REPLACE that source's rows with it: the payload IS the price book, so every
 * push is idempotent and a stale row can't outlive the feed that produced it.
 * A source that receives rows becomes 'active'. A 'disabled' source refuses
 * the feed outright (the admin kill switch must actually stop it).
 */
export async function ingestIntoSource(
  db: D1Database,
  source: { id: string; org_id: string; status: string; config: unknown },
  payload: unknown,
): Promise<IngestResult> {
  if (source.status === 'disabled') {
    return { ok: false, code: 409, error: 'This pricing source is disabled — enable it before sending prices' };
  }
  const body = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
  const items = body.items;
  const dryRun = body.dryRun === true;
  if (!Array.isArray(items)) return { ok: false, code: 400, error: 'Body must be JSON of the form { "items": [ ... ] }' };
  if (items.length === 0) return { ok: false, code: 400, error: 'items is empty' };
  if (items.length > MAX_INGEST_ITEMS) {
    return { ok: false, code: 413, error: `Too many items (${items.length}); send at most ${MAX_INGEST_ITEMS} per request` };
  }

  const cfg = parseConfig(source.config);
  const { rows, errors } = normalizePricingItems(items, { categoryMap: cfg.categoryMap });
  if (rows.length === 0) {
    return { ok: false, code: 400, error: 'No valid price rows in payload', details: errors.slice(0, 20) };
  }
  const outcome: IngestOutcome = {
    loaded: rows.length,
    skipped: errors.length,
    errors: errors.slice(0, 20),
    dryRun,
    matchKeys: Array.from(new Set(rows.map((r) => r.matchKey))),
  };
  if (dryRun) return { ok: true, outcome, status: source.status };

  const stmts: D1PreparedStatement[] = [];
  stmts.push(db.prepare('DELETE FROM pricing_items WHERE source_id = ? AND org_id = ?').bind(source.id, source.org_id));
  const ins = db.prepare(
    `INSERT INTO pricing_items
       (id, org_id, source_id, category, match_key, model, description, unit, unit_price, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    stmts.push(ins.bind(generateId(), source.org_id, source.id, r.category, r.matchKey, r.model, r.description, r.unit, r.unitPrice, r.currency));
  }
  const summary = JSON.stringify({ loaded: rows.length, skipped: errors.length, at: new Date().toISOString() });
  stmts.push(db.prepare(
    `UPDATE pricing_sources
        SET item_count = ?, status = 'active', last_ingest_at = datetime('now'),
            last_ingest_summary = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`
  ).bind(rows.length, summary, source.id, source.org_id));

  for (let i = 0; i < stmts.length; i += BATCH_CHUNK) {
    await db.batch(stmts.slice(i, i + BATCH_CHUNK));
  }
  return { ok: true, outcome, status: 'active' };
}

// ═════════════════════════════════════════════════════════════════════════════
// NORMALIZER — one validation surface for every channel (CSV, inbound JSON,
// admin push, future pull). A row that is bad here is bad everywhere.
// ═════════════════════════════════════════════════════════════════════════════
export interface ParsedRow {
  category: string;
  matchKey: string;
  model: string;
  description: string;
  unit: string;
  unitPrice: number;
  currency: string;
}

export interface NormalizeOptions {
  /** Supplier product-group → category (keys compared lowercased). */
  categoryMap?: Record<string, string>;
}

type CanonicalField =
  | 'category' | 'unit_price' | 'system_type' | 'tonnage' | 'model'
  | 'description' | 'unit' | 'match_key' | 'currency';

/** Key normalization: lowercase, non-alphanumerics stripped — so "Unit Price",
 *  "unit_price", "UnitPrice" and "unit-price" are the same field. */
export function normKey(k: string): string {
  return String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Accepted column / property names per canonical field, in NORMALIZED form
 * (see normKey). The canonical name comes first and wins when a record carries
 * several candidates. The aliases are the names a distributor ERP export (DDI
 * Inform item/price extracts, middleware payloads) typically uses, so a native
 * export can load without hand-renaming columns.
 */
export const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  category:    ['category', 'productgroup', 'productclass', 'itemclass', 'itemgroup', 'group', 'class'],
  unit_price:  ['unitprice', 'price', 'netprice', 'contractprice', 'customerprice', 'custprice', 'sellprice', 'unitcost'],
  system_type: ['systemtype', 'equipmenttype'],
  tonnage:     ['tonnage', 'tons', 'capacitytons', 'nominaltons'],
  model:       ['model', 'modelnumber', 'itemnumber', 'itemno', 'itemid', 'sku', 'partnumber', 'mfrmodel', 'mfgmodel'],
  description: ['description', 'desc', 'itemdescription', 'name'],
  unit:        ['unit', 'uom', 'unitofmeasure'],
  match_key:   ['matchkey'],
  currency:    ['currency', 'currencycode'],
};

function hasField(present: Set<string>, field: CanonicalField): boolean {
  return FIELD_ALIASES[field].some((a) => present.has(a));
}

/** First alias present in the record wins (even if its value is empty — a
 *  present-but-blank canonical column must not be silently overridden by a
 *  differently-named column further along). Returns '' when none is present. */
function pick(fields: Map<string, string>, field: CanonicalField): string {
  for (const a of FIELD_ALIASES[field]) {
    if (fields.has(a)) return fields.get(a) ?? '';
  }
  return '';
}

/** Flatten a JSON item into a normalized-key → trimmed-string map. Numbers are
 *  stringified (4850 → "4850"); null/undefined/objects become ''. */
function toFieldMap(obj: Record<string, unknown>): Map<string, string> {
  const fields = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const nk = normKey(k);
    if (!nk || fields.has(nk)) continue;
    const s = v == null ? '' : typeof v === 'object' ? '' : String(v);
    fields.set(nk, s.trim());
  }
  return fields;
}

/**
 * Validate + normalize one record. Error strings are stable — the CSV tests
 * and the integrator-facing doc both quote them.
 *
 *   category    required — equipment|ductwork|controls|labor|permits|misc
 *                          (or a key of options.categoryMap)
 *   unit_price  required — number > 0 ($ / thousands commas ok). Blank,
 *                          "$"-only, 0 and negatives are REJECTED, never
 *                          coerced to $0.00.
 *   system_type optional — heat_pump|ac_furnace|mini_split|packaged
 *   tonnage     optional — number (for equipment); "3.5 ton" tolerated
 *   model / description / unit / currency / match_key — optional
 *
 * `match_key` is what the estimator resolves per line. If not given it is
 * derived: equipment rows with system_type+tonnage → equipment:<type>:<tons>;
 * otherwise <category>:<model|description> (lowercased), else <category>.
 */
export function normalizePricingRow(
  fields: Map<string, string>,
  label: string,
  opts: NormalizeOptions = {},
): { row?: ParsedRow; error?: string } {
  const rawCategory = pick(fields, 'category');
  let category = rawCategory.trim().toLowerCase();
  if (!VALID_CATEGORIES.has(category) && opts.categoryMap && category) {
    const mapped = opts.categoryMap[category];
    if (mapped) category = mapped;
  }
  if (!VALID_CATEGORIES.has(category)) return { error: `${label}: unknown category "${rawCategory}"` };

  // Guard the raw string BEFORE coercion: Number('') === 0, so a blank (or
  // "$"-only) cell would otherwise load as a silent $0.00 that the estimator
  // badges as the org's real sourced pricing on a customer-facing estimate.
  const priceCell = pick(fields, 'unit_price');
  const priceRaw = priceCell.replace(/[$,\s]/g, '');
  if (!priceRaw) return { error: `${label}: missing unit_price` };
  const unitPrice = Number(priceRaw);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: `${label}: invalid unit_price "${priceCell}"` };
  // A $0 line rendered as real distributor pricing understates the estimate.
  // Distributor price books don't carry $0; omit the row instead.
  if (unitPrice === 0) return { error: `${label}: unit_price must be greater than 0` };

  const systemType = pick(fields, 'system_type').toLowerCase().replace(/[\s-]+/g, '_');
  const tonnageRaw = pick(fields, 'tonnage');
  const model = pick(fields, 'model').slice(0, 120);
  const description = pick(fields, 'description').slice(0, 240);
  const unit = (pick(fields, 'unit') || 'each').slice(0, 16);
  const currency = (pick(fields, 'currency') || 'USD').toUpperCase().slice(0, 3);

  let matchKey = pick(fields, 'match_key').toLowerCase();
  if (!matchKey) {
    if (category === 'equipment' && VALID_SYSTEM_TYPES.has(systemType) && tonnageRaw) {
      // parseFloat (not Number) so "3.5 ton" → 3.5; the NUMBER is interpolated
      // so 2.0 → "2", matching the estimator's own key string.
      const tons = Number.parseFloat(tonnageRaw);
      matchKey = Number.isFinite(tons) ? `equipment:${systemType}:${tons}` : `equipment:${systemType}`;
    } else {
      const tail = (model || description).toLowerCase().trim();
      matchKey = tail ? `${category}:${tail}` : category;
    }
  }

  return { row: { category, matchKey, model, description, unit, unitPrice, currency } };
}

/** Normalize a JSON `items` array (inbound feed / admin push). */
export function normalizePricingItems(
  items: unknown,
  opts: NormalizeOptions = {},
): { rows: ParsedRow[]; errors: string[] } {
  if (!Array.isArray(items)) return { rows: [], errors: ['items must be an array'] };
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  items.forEach((it, i) => {
    const label = `Item ${i + 1}`;
    if (!it || typeof it !== 'object' || Array.isArray(it)) { errors.push(`${label}: not an object`); return; }
    const { row, error } = normalizePricingRow(toFieldMap(it as Record<string, unknown>), label, opts);
    if (error) errors.push(error);
    else if (row) rows.push(row);
  });
  return { rows, errors };
}

/**
 * Parse a distributor price-list CSV into normalized rows. Header names are
 * case-insensitive, order-independent, and accept the FIELD_ALIASES above;
 * unknown columns are ignored so a native ERP export loads as-is. Requires a
 * category column and a unit_price column (by any accepted alias).
 */
export function parsePricingCsv(text: string, opts: NormalizeOptions = {}): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ['CSV needs a header row and at least one data row'] };

  const header = splitCsvLine(lines[0]).map(normKey);
  const present = new Set(header.filter(Boolean));
  if (!hasField(present, 'category') || !hasField(present, 'unit_price')) {
    return { rows: [], errors: ['CSV must have at least "category" and "unit_price" columns'] };
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const fields = new Map<string, string>();
    header.forEach((h, idx) => {
      if (h && !fields.has(h)) fields.set(h, (cells[idx] ?? '').trim());
    });
    const { row, error } = normalizePricingRow(fields, `Row ${i + 1}`, opts);
    if (error) errors.push(error);
    else if (row) rows.push(row);
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
