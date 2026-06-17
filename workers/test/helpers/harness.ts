/**
 * Integration-test harness — shared setup for the cross-tenant isolation suite.
 *
 * What it provides:
 *   - applyMigrations(db): runs the REAL migrations 0001-0011 against the
 *     per-run Miniflare D1, building the exact production schema.
 *   - seedTenant(...): inserts an org + a user directly into D1 and mints a
 *     REAL session via the production mintTokenPair() (tokens are SHA-256
 *     hashed at rest — the same code path the live login uses). Returns the
 *     RAW bearer token to send on requests.
 *   - seedOrgAOwnedRows(...): inserts one project / calculation / cad_drawing /
 *     cad_drawing_version / file_upload, all owned by a given org, directly in
 *     D1 (bypassing the API so the rows exist regardless of route behavior).
 *   - call(...): dispatches an actual Request through the REAL Hono app
 *     (worker default export) with the REAL authMiddleware in the chain.
 *
 * Nothing here mocks the DB or bypasses auth. The whole point is to prove the
 * production isolation clauses are correct against a real database.
 */
import { env } from 'cloudflare:test';
import { inject } from 'vitest';

import worker from '../../src/index';
import { mintTokenPair } from '../../src/utils/session';
import { generateId } from '../../src/utils/id';

interface ProvidedMigration {
  file: string;
  statements: string[];
}

/** Apply migrations 0001-0011 in order to a fresh D1.
 *
 *  The SQL is read + pre-split on the Node side (vitest.config.mts) and handed
 *  in via Vitest's provide/inject channel — workerd's node:fs can't reliably
 *  read the host .sql files on Windows. Idempotent statements (CREATE TABLE IF
 *  NOT EXISTS) tolerate re-runs; ALTER TABLE statements do not, so this must
 *  run exactly once per fresh DB (isolatedStorage gives us that). */
export async function applyMigrations(db: D1Database): Promise<void> {
  const migrations = inject('migrations' as never) as unknown as ProvidedMigration[];
  if (!migrations || migrations.length === 0) {
    throw new Error('No migrations were provided to the test runtime (check vitest.config.mts `provide.migrations`).');
  }
  for (const { file, statements } of migrations) {
    for (const stmt of statements) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        throw new Error(
          `Migration ${file} failed on statement:\n${stmt}\n\n${(e as Error).message}`,
        );
      }
    }
  }

  // ── Out-of-band schema reconciliation (test DB only) ─────────────────────
  // `organisations.billing_status` was queried by routes/platform.ts
  // (GET /orgs, /orgs/:id, /metrics) but historically existed in NO migration —
  // it was added to PRODUCTION out-of-band, the same class of drift CLAUDE.md
  // §0 calls out for `is_platform_admin` + the base `audit_log` table.
  //
  // CODIFIED 2026-06-10: the column is now created by the 0001 organisations
  // CREATE TABLE (no-op on prod via CREATE TABLE IF NOT EXISTS; see 0012's
  // header for the reconciliation record). A fresh rebuild from migrations now
  // gets the column, so the ALTER below is REDUNDANT. It stays as a harmless
  // no-op (the try/catch already swallows "duplicate column") — it
  // self-documents the historical gap and protects any environment somehow
  // still missing the column.
  await reconcileOutOfBandColumns(db);
}

/** Add columns that exist in production-via-out-of-band-ALTER but are absent
 *  from the migration files, so the test schema matches prod. SQLite has no
 *  `ADD COLUMN IF NOT EXISTS`, so each is wrapped in try/catch (idempotent).
 *
 *  NOTE: `billing_status` is now codified in the 0001 migration (2026-06-10),
 *  so on a fresh rebuild the column already exists and this ALTER throws
 *  "duplicate column name" — swallowed below. Kept as a harmless backstop. */
async function reconcileOutOfBandColumns(db: D1Database): Promise<void> {
  const fixes = [
    `ALTER TABLE organisations ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'free_beta'`,
  ];
  for (const sql of fixes) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Column already present — nothing to do.
    }
  }
}

export interface SeededTenant {
  orgId: string;
  userId: string;
  /** RAW access token — send as `Authorization: Bearer <token>`. */
  token: string;
  email: string;
  role: string;
}

export interface SeedTenantOpts {
  slug: string;
  name: string;
  email: string;
  role?: 'admin' | 'engineer' | 'tech' | 'viewer';
  isPlatformAdmin?: boolean;
  isPermitAuthority?: boolean;
  /** Marks the org as a permit authority (authority_type set). */
  authorityType?: string | null;
}

/** Insert an org + user and mint a REAL session token pair. The accessToken
 *  returned is the same kind of credential the production login issues, stored
 *  hashed in `sessions.token` via the production mintTokenPair(). */
export async function seedTenant(
  db: D1Database,
  opts: SeedTenantOpts,
): Promise<SeededTenant> {
  const orgId = generateId();
  const userId = generateId();
  const role = opts.role ?? 'admin';

  await db
    .prepare(
      `INSERT INTO organisations (id, slug, name, org_type, plan, seats_limit, authority_type)
       VALUES (?, ?, ?, 'company', 'starter', 5, ?)`,
    )
    .bind(orgId, opts.slug, opts.name, opts.authorityType ?? null)
    .run();

  await db
    .prepare(
      `INSERT INTO users
         (id, org_id, email, password_hash, role, first_name, last_name,
          is_verified, is_platform_admin, is_permit_authority, status)
       VALUES (?, ?, ?, 'x:y', ?, 'Test', 'User', 1, ?, ?, 'active')`,
    )
    .bind(
      userId,
      orgId,
      opts.email,
      role,
      opts.isPlatformAdmin ? 1 : 0,
      opts.isPermitAuthority ? 1 : 0,
    )
    .run();

  // REAL session mint — hashes the token with the production hashToken() and
  // writes the hash into sessions.token, exactly like the live login path.
  const { accessToken } = await mintTokenPair(db, userId, orgId);

  return { orgId, userId, token: accessToken, email: opts.email, role };
}

export interface SeededOrgRows {
  projectId: string;
  calculationId: string;
  cadDrawingId: string;
  cadVersionId: string;
  fileUploadId: string;
  // Billing foundation (migration 0012) — one org-A-owned row per strict table.
  subscriptionId: string;
  paymentMethodId: string;
  usageEventId: string;
  invoiceId: string;
}

/** Seed one org-A-owned row in each strict table, written directly to D1 so
 *  the rows exist independent of any route behavior. Every row carries
 *  org_id = orgId. */
export async function seedOrgOwnedRows(
  db: D1Database,
  orgId: string,
  userId: string,
): Promise<SeededOrgRows> {
  const projectId = generateId();
  const calculationId = generateId();
  const cadDrawingId = generateId();
  const cadVersionId = generateId();
  const fileUploadId = generateId();
  const subscriptionId = generateId();
  const paymentMethodId = generateId();
  const usageEventId = generateId();
  const invoiceId = generateId();

  await db
    .prepare(
      `INSERT INTO projects (id, org_id, name, standard, status, created_by)
       VALUES (?, ?, 'Org-A Secret Project', 'ACCA', 'active', ?)`,
    )
    .bind(projectId, orgId, userId)
    .run();

  await db
    .prepare(
      `INSERT INTO calculations
         (id, project_id, org_id, calc_type, version, inputs, outputs, status,
          engine_version, computed_by, computed_at, duration_ms)
       VALUES (?, ?, ?, 'MANUAL_J', 1, ?, ?, 'complete', 'manualJ8-ts-1.1.0', ?, datetime('now'), 12)`,
    )
    .bind(
      calculationId,
      projectId,
      orgId,
      JSON.stringify({ secret: 'org-a-inputs' }),
      JSON.stringify({ secret: 'org-a-outputs', heatBtuh: 42000 }),
      userId,
    )
    .run();

  const canvasJson = JSON.stringify({ objects: [{ secret: 'org-a-canvas' }] });
  await db
    .prepare(
      `INSERT INTO cad_drawings
         (id, project_id, org_id, name, floor_index, canvas_json, created_by)
       VALUES (?, ?, ?, 'Org-A Floor Plan', 0, ?, ?)`,
    )
    .bind(cadDrawingId, projectId, orgId, canvasJson, userId)
    .run();

  await db
    .prepare(
      `INSERT INTO cad_drawing_versions
         (id, drawing_id, project_id, org_id, version_number, canvas_json,
          size_bytes, author_user_id)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      cadVersionId,
      cadDrawingId,
      projectId,
      orgId,
      canvasJson,
      canvasJson.length,
      userId,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO file_uploads
         (id, org_id, project_id, r2_key, filename, content_type, size_bytes,
          purpose, uploaded_by)
       VALUES (?, ?, ?, ?, 'org-a-secret.pdf', 'application/pdf', 1024, 'attachment', ?)`,
    )
    .bind(fileUploadId, orgId, projectId, `${orgId}/${projectId}/${fileUploadId}.pdf`, userId)
    .run();

  // ── Billing foundation (migration 0012) — one org-A row per strict table ──
  await db
    .prepare(
      `INSERT INTO subscriptions (id, org_id, provider, plan, status)
       VALUES (?, ?, 'manual', 'free_beta', 'active')`,
    )
    .bind(subscriptionId, orgId)
    .run();

  await db
    .prepare(
      `INSERT INTO payment_methods
         (id, org_id, provider, method_type, display_label, is_default, status)
       VALUES (?, ?, 'manual', 'erp_invoice', 'Org-A NET-30', 1, 'active')`,
    )
    .bind(paymentMethodId, orgId)
    .run();

  await db
    .prepare(
      `INSERT INTO usage_events
         (id, org_id, meter_key, quantity, unit, source_ref, metadata)
       VALUES (?, ?, 'calc_run', 1, 'count', ?, ?)`,
    )
    .bind(usageEventId, orgId, calculationId, JSON.stringify({ secret: 'org-a-usage' }))
    .run();

  await db
    .prepare(
      `INSERT INTO invoices
         (id, org_id, subscription_id, provider, provider_invoice_ref,
          amount_minor, currency, status)
       VALUES (?, ?, ?, 'manual', ?, 4900, 'USD', 'open')`,
    )
    .bind(invoiceId, orgId, subscriptionId, `manual:${orgId}:1`)
    .run();

  return {
    projectId,
    calculationId,
    cadDrawingId,
    cadVersionId,
    fileUploadId,
    subscriptionId,
    paymentMethodId,
    usageEventId,
    invoiceId,
  };
}

/** Insert an org-scoped `plan_entitlements` row directly into D1 so the
 *  metering gate can be exercised. Defaults to a BLOCKING hard-cap rule
 *  (enforcement='block') — the only configuration that can make
 *  checkEntitlement deny. `period` defaults to 'lifetime' so the test isn't
 *  sensitive to the calendar. */
export async function seedPlanEntitlement(
  db: D1Database,
  opts: {
    orgId: string;
    meterKey: string;
    hardCap: number;
    enforcement?: 'block' | 'meter';
    period?: 'monthly' | 'daily' | 'lifetime';
    includedQuantity?: number | null;
  },
): Promise<string> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO plan_entitlements
         (id, org_id, scope_kind, meter_key, included_quantity, hard_cap,
          period, enforcement)
       VALUES (?, ?, 'org', ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.orgId,
      opts.meterKey,
      opts.includedQuantity ?? null,
      opts.hardCap,
      opts.period ?? 'lifetime',
      opts.enforcement ?? 'block',
    )
    .run();
  return id;
}

/** Dispatch an actual Request through the REAL Hono app + REAL authMiddleware.
 *  `token` is the RAW bearer (omit for an unauthenticated request). */
export async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const req = new Request(`https://test.local${path}`, {
    method,
    headers,
    body,
  });
  // ExecutionContext is required by the worker's fetch signature.
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return worker.fetch(req, env as unknown as Parameters<typeof worker.fetch>[1], ctx);
}

/** Convenience: dispatch + parse JSON body, returning both. */
export async function callJson(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await call(method, path, opts);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
