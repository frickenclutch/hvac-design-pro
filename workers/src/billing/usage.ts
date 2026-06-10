// workers/src/billing/usage.ts
//
// The flexible generic usage meter + the NON-BREAKING entitlement gate.
//
// Pure D1 helpers — org_id is ALWAYS a parameter, and the routes pass
// `c.get('user').orgId` (the session-derived org, NEVER a client-supplied one).
//
// Two append-only invariants honoured: usage_events is insert-only (corrections
// are new rows). checkEntitlement DEFAULT-ALLOWS when no entitlement row exists,
// so wiring this into existing flows later is non-breaking until an admin/L0
// explicitly configures a limit.

import { generateId } from '../utils/id';

/** Append-only: record one metered occurrence of ANY unit. Idempotent on
 *  (org_id, meter_key, source_ref) via the partial unique index — a retried
 *  calc/packet won't double-count. org_id MUST be the session-derived org. */
export async function recordUsageEvent(
  db: D1Database,
  orgId: string,
  meterKey: string,
  quantity = 1,
  opts: {
    unit?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
  } = {},
): Promise<{ recorded: boolean; id: string }> {
  const id = generateId();
  try {
    await db
      .prepare(
        `INSERT INTO usage_events (id, org_id, meter_key, quantity, unit, source_ref, occurred_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
      )
      .bind(
        id,
        orgId,
        meterKey,
        quantity,
        opts.unit ?? 'count',
        opts.sourceRef ?? null,
        opts.occurredAt ?? null,
        JSON.stringify(opts.metadata ?? {}),
      )
      .run();
    return { recorded: true, id };
  } catch (e) {
    // UNIQUE(org_id, meter_key, source_ref) violation → already counted. The
    // meter is idempotent by design; treat a dupe as a successful no-op.
    if (String((e as Error).message).includes('UNIQUE')) return { recorded: false, id };
    throw e;
  }
}

/** Aggregate a meter for an org over an optional window. Always org-scoped. */
export async function aggregateUsage(
  db: D1Database,
  orgId: string,
  meterKey: string,
  opts: { since?: string } = {},
): Promise<number> {
  const since = opts.since ?? null;
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS total
       FROM usage_events
       WHERE org_id = ? AND meter_key = ?
         AND (? IS NULL OR occurred_at >= ?)`,
    )
    .bind(orgId, meterKey, since, since)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export interface EntitlementDecision {
  allowed: boolean;
  gated: boolean; // false = no rule configured (default-allow path)
  meterKey: string;
  used?: number;
  hardCap?: number | null;
  includedQuantity?: number | null;
  reason: string;
}

/** NON-BREAKING gate. Resolves the most specific entitlement row for
 *  (org, meter): an org-scoped row wins over a plan-wide row. If NO row exists,
 *  returns allowed:true, gated:false — so existing prod flows are unaffected
 *  until an entitlement is explicitly configured. Only 'block' enforcement with
 *  a hard_cap can deny. */
export async function checkEntitlement(
  db: D1Database,
  orgId: string,
  meterKey: string,
): Promise<EntitlementDecision> {
  // tenant-scope-ok: plan_entitlements resolves an org override (e.org_id = ?)
  // OR a plan-wide rule (e.scope_kind='plan' matched on the org's own plan,
  // joined from organisations WHERE o.id = ?). Both branches are bound to the
  // session-derived orgId passed in — there is NO client-supplied org filter
  // here, and the plan-wide sentinel org_id='*' is never bound from request
  // input. plan_entitlements is intentionally NOT in the strict-table list
  // (see scripts/check-tenant-scoping.mjs) because of the sentinel scope.
  const rule = await db
    .prepare(
      `SELECT e.included_quantity, e.hard_cap, e.period, e.enforcement, e.scope_kind
       FROM plan_entitlements e
       LEFT JOIN organisations o ON o.id = ?
       WHERE e.meter_key = ?
         AND (
           (e.scope_kind = 'org'  AND e.org_id = ?)
           OR (e.scope_kind = 'plan' AND e.plan = o.plan)
         )
       ORDER BY (e.scope_kind = 'org') DESC
       LIMIT 1`,
    )
    .bind(orgId, meterKey, orgId)
    .first<{
      included_quantity: number | null;
      hard_cap: number | null;
      period: string;
      enforcement: string;
      scope_kind: string;
    }>();

  // DEFAULT-ALLOW: no rule → ungated. This is the non-breaking guarantee.
  if (!rule) {
    return {
      allowed: true,
      gated: false,
      meterKey,
      reason: 'no entitlement configured (default-allow)',
    };
  }

  // 'meter' enforcement never blocks — it only annotates.
  if (rule.enforcement !== 'block' || rule.hard_cap === null) {
    return {
      allowed: true,
      gated: true,
      meterKey,
      includedQuantity: rule.included_quantity,
      hardCap: rule.hard_cap,
      reason: 'metered (not blocking)',
    };
  }

  const since =
    rule.period === 'monthly'
      ? "datetime('now','start of month')"
      : rule.period === 'daily'
        ? "datetime('now','start of day')"
        : null; // lifetime
  const used = await aggregateUsageForPeriod(db, orgId, meterKey, since);
  const allowed = used < rule.hard_cap;
  return {
    allowed,
    gated: true,
    meterKey,
    used,
    hardCap: rule.hard_cap,
    includedQuantity: rule.included_quantity,
    reason: allowed ? 'within hard cap' : 'hard cap reached',
  };
}

/** Period-aware SUM. `sinceExpr` is selected from a FIXED internal set of SQL
 *  literals in checkEntitlement (never request input) — no injection surface.
 *  org_id is bound, always the session-derived org. */
async function aggregateUsageForPeriod(
  db: D1Database,
  orgId: string,
  meterKey: string,
  sinceExpr: string | null,
): Promise<number> {
  const whereTime = sinceExpr ? `AND occurred_at >= ${sinceExpr}` : '';
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(quantity),0) AS total FROM usage_events
       WHERE org_id = ? AND meter_key = ? ${whereTime}`,
    )
    .bind(orgId, meterKey)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}
