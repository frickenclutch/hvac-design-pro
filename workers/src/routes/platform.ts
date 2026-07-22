/**
 * /api/platform/* — Creator layer (C4 Technologies)
 *
 * Read-first foundation for cross-tenant operations. Every handler here
 * operates OUTSIDE the org_id scope enforced in every other route and is
 * gated behind `requirePlatformAdmin`. Abuse here bypasses tenancy, so:
 *   - keep the route surface minimal
 *   - never reflect raw SQL errors to the caller
 *   - audit every destructive action (future: audit_log writes)
 *
 * Started read-only; now also carries the L0 write surface that has grown
 * dedicated audit paths: cross-tenant user management, access-policy
 * overrides, and read-only org impersonation. Plan overrides and
 * billing-status changes remain future units.
 */

import { Hono } from 'hono';
import { requirePlatformAdmin, type AuthUser } from '../middleware/auth';
import { setAudit } from '../middleware/audit';
import { hashToken } from '../utils/crypto';
import { mintImpersonationSession } from '../utils/session';
import {
  resolveAccessPolicy,
  sanitizeAccessPolicyPatch,
  mergeAccessPolicyIntoSettings,
} from '../utils/accessPolicy';
import { computeRoleChangePlan } from '../utils/roleChange';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export const platformRoutes = new Hono<{ Bindings: Env }>();

// Every route in this namespace requires platform admin privilege.
platformRoutes.use('*', requirePlatformAdmin);

// ── GET /api/platform/orgs ──────────────────────────────────────────────────
// List every organisation with headline stats. Paginated only once the list
// grows past a few hundred tenants — cheap full-scan for now.
platformRoutes.get('/orgs', async (c) => {
  const db = c.env.DB;

  const { results } = await db.prepare(
    `SELECT
       o.id, o.slug, o.name, o.org_type, o.plan, o.seats_limit,
       o.billing_status, o.region_code, o.created_at,
       (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS user_count,
       (SELECT COUNT(*) FROM projects p WHERE p.org_id = o.id) AS project_count,
       (SELECT MAX(last_seen_at) FROM users u WHERE u.org_id = o.id) AS last_active_at
     FROM organisations o
     ORDER BY o.created_at DESC`
  ).all();

  return c.json({ organisations: results });
});

// ── GET /api/platform/orgs/:id ──────────────────────────────────────────────
// Org detail — users list, project count, storage/calc totals. Used by the
// (future) admin UI to render a tenant dossier.
platformRoutes.get('/orgs/:id', async (c) => {
  const db = c.env.DB;
  const orgId = c.req.param('id');

  const org = await db.prepare(
    `SELECT id, slug, name, org_type, plan, seats_limit, billing_status,
            region_code, address_line1, city, state, zip, country, phone,
            acca_cert_num, stripe_cust_id, created_at
     FROM organisations WHERE id = ?`
  ).bind(orgId).first();

  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const { results: users } = await db.prepare(
    `SELECT id, email, first_name, last_name, role, is_verified,
            is_platform_admin, created_at, last_seen_at
     FROM users WHERE org_id = ?
     ORDER BY created_at ASC`
  ).bind(orgId).all();

  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM projects WHERE org_id = ?) AS project_count,
       (SELECT COUNT(*) FROM calculations WHERE org_id = ?) AS calculation_count,
       (SELECT COUNT(*) FROM cad_drawings WHERE org_id = ?) AS drawing_count`
  ).bind(orgId, orgId, orgId).first();

  return c.json({
    organisation: org,
    users,
    counts,
  });
});

// ── GET /api/platform/metrics ───────────────────────────────────────────────
// Platform-wide KPI scan. Cheap counters + last-30-days activity. Intended
// for the admin dashboard and weekly internal reviews.
platformRoutes.get('/metrics', async (c) => {
  const db = c.env.DB;

  const totals = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM organisations) AS org_count,
       (SELECT COUNT(*) FROM organisations WHERE billing_status = 'free_beta') AS org_free_beta,
       (SELECT COUNT(*) FROM organisations WHERE billing_status = 'active') AS org_paid,
       (SELECT COUNT(*) FROM users) AS user_count,
       (SELECT COUNT(*) FROM users WHERE is_verified = 1) AS verified_user_count,
       (SELECT COUNT(*) FROM projects) AS project_count,
       (SELECT COUNT(*) FROM calculations) AS calculation_count,
       (SELECT COUNT(*) FROM cad_drawings) AS drawing_count`
  ).first();

  const recent = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM projects WHERE created_at > datetime('now', '-30 days')) AS projects_30d,
       (SELECT COUNT(*) FROM calculations WHERE created_at > datetime('now', '-30 days')) AS calculations_30d,
       (SELECT COUNT(*) FROM users WHERE created_at > datetime('now', '-30 days')) AS signups_30d,
       (SELECT COUNT(*) FROM users WHERE last_seen_at > datetime('now', '-7 days')) AS active_users_7d`
  ).first();

  const { results: orgTypes } = await db.prepare(
    `SELECT org_type, COUNT(*) AS count
     FROM organisations
     GROUP BY org_type`
  ).all();

  const { results: planTiers } = await db.prepare(
    `SELECT plan, COUNT(*) AS count
     FROM organisations
     GROUP BY plan`
  ).all();

  return c.json({
    totals,
    recent,
    breakdown: {
      orgTypes,
      planTiers,
    },
    generatedAt: new Date().toISOString(),
  });
});

// ── GET /api/platform/audit ─────────────────────────────────────────────────
// Recent cross-org audit events. Capped at 200 for now; paginate when needed.
platformRoutes.get('/audit', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 200);

  const { results } = await db.prepare(
    `SELECT a.id, a.org_id, a.user_id, a.project_id, a.action, a.entity_type,
            a.entity_id, a.detail, a.ip_address, a.created_at,
            o.name AS org_name,
            u.email AS user_email
     FROM audit_log a
     LEFT JOIN organisations o ON o.id = a.org_id
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT ?`
  ).bind(limit).all();

  return c.json({ events: results, limit });
});

// ── GET /api/platform/qa-benchmarks ─────────────────────────────────────────
// Cross-tenant quality / accuracy / throughput scoreboard for the L0 admin
// panel. Pulls only from the `calculations` and `audit_log` tables and joins
// them with static cert facts about the active engine version. No PII.
//
// Sections:
//  - certification: hard-coded ACCA validation results for the engine version
//    currently shipped (manualJ8 v1.3.0). These travel with the build, not
//    the DB, because the cert package was filed against a specific revision.
//  - engineVersions: distribution of engine_version stamped onto persisted
//    calculations — answers "which engine ran what in prod"
//  - calcVolume: 24h/7d/30d counts split by status (complete / error /
//    pending) so an operator sees error rate at a glance
//  - calcDuration: p50/p95/p99 over the last 30 days for calcs that report
//    duration_ms. Uses a window-function CTE to avoid pulling rows.
//  - calcMix: distribution by calc_type so you can tell whether Manual D /
//    Manual S adoption is moving
//  - auditVolume: event counts in 24h / 7d / 30d
platformRoutes.get('/qa-benchmarks', async (c) => {
  const db = c.env.DB;

  // ── Engine version × calc_type distribution ────────────────────────────
  const { results: engineVersions } = await db.prepare(
    `SELECT engine_version, calc_type, COUNT(*) AS count
     FROM calculations
     GROUP BY engine_version, calc_type
     ORDER BY count DESC`
  ).all();

  // ── Volume by status across windows ────────────────────────────────────
  const calcVolume = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM calculations) AS total,
       (SELECT COUNT(*) FROM calculations WHERE created_at > datetime('now', '-1 day')) AS d24h,
       (SELECT COUNT(*) FROM calculations WHERE created_at > datetime('now', '-7 days')) AS d7,
       (SELECT COUNT(*) FROM calculations WHERE created_at > datetime('now', '-30 days')) AS d30,
       (SELECT COUNT(*) FROM calculations WHERE status = 'complete' AND created_at > datetime('now', '-30 days')) AS d30_complete,
       (SELECT COUNT(*) FROM calculations WHERE status = 'error'    AND created_at > datetime('now', '-30 days')) AS d30_error,
       (SELECT COUNT(*) FROM calculations WHERE status = 'pending'  AND created_at > datetime('now', '-30 days')) AS d30_pending`
  ).first();

  // ── Duration percentiles over last 30d ─────────────────────────────────
  // SQLite has no built-in PERCENTILE; we synthesise with a window CTE.
  // Bucketing on duration_ms IS NOT NULL filters out failed/pending rows.
  const calcDuration = await db.prepare(
    `WITH ordered AS (
       SELECT duration_ms,
              ROW_NUMBER() OVER (ORDER BY duration_ms) AS rn,
              COUNT(*) OVER () AS cnt
       FROM calculations
       WHERE duration_ms IS NOT NULL
         AND duration_ms > 0
         AND created_at > datetime('now', '-30 days')
     )
     SELECT
       cnt AS sample_size,
       MAX(CASE WHEN rn <= cnt * 0.50 THEN duration_ms END) AS p50,
       MAX(CASE WHEN rn <= cnt * 0.95 THEN duration_ms END) AS p95,
       MAX(CASE WHEN rn <= cnt * 0.99 THEN duration_ms END) AS p99,
       MAX(duration_ms) AS p100
     FROM ordered`
  ).first();

  // ── Calc-type mix ──────────────────────────────────────────────────────
  const { results: calcMix } = await db.prepare(
    `SELECT calc_type, COUNT(*) AS count
     FROM calculations
     GROUP BY calc_type
     ORDER BY count DESC`
  ).all();

  // ── Audit activity ─────────────────────────────────────────────────────
  const auditVolume = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM audit_log) AS total,
       (SELECT COUNT(*) FROM audit_log WHERE created_at > datetime('now', '-1 day')) AS d24h,
       (SELECT COUNT(*) FROM audit_log WHERE created_at > datetime('now', '-7 days')) AS d7,
       (SELECT COUNT(*) FROM audit_log WHERE created_at > datetime('now', '-30 days')) AS d30`
  ).first();

  // ── Phase 1 shadow-run drift aggregate ────────────────────────────────
  // The Manual J calculator persists two records per user click — one for
  // the legacy engine (displayed) and one for the cert-grade shadow-run.
  // Shadow-run records carry their drift-vs-legacy in the outputs JSON
  // under `__driftVsLegacy.{heat,sens,latent}`. We aggregate over the
  // last 30d of cert-grade records that include the marker. Failure
  // marker records have engine_version ending in `-fail` and are
  // counted separately so we can report shadow-run reliability.
  //
  // SQLite's json_extract works on TEXT columns; outputs is TEXT JSON.
  // `n_projects` = COUNT(DISTINCT project_id) over the same drift rows. This
  // is the actual Phase-2 readiness gate (≥ 10 *distinct projects*, not ≥ 10
  // rows) — a single project re-run 50 times must NOT clear the bar.
  const driftAgg = await db.prepare(
    `SELECT
       COUNT(*) AS sample_size,
       COUNT(DISTINCT project_id) AS n_projects,
       AVG(ABS(CAST(json_extract(outputs, '$.__driftVsLegacy.heat')   AS REAL))) AS avg_abs_heat_pct,
       AVG(ABS(CAST(json_extract(outputs, '$.__driftVsLegacy.sens')   AS REAL))) AS avg_abs_sens_pct,
       AVG(ABS(CAST(json_extract(outputs, '$.__driftVsLegacy.latent') AS REAL))) AS avg_abs_latent_pct,
       MAX(ABS(CAST(json_extract(outputs, '$.__driftVsLegacy.heat')   AS REAL))) AS max_abs_heat_pct,
       MAX(ABS(CAST(json_extract(outputs, '$.__driftVsLegacy.sens')   AS REAL))) AS max_abs_sens_pct,
       MAX(ABS(CAST(json_extract(outputs, '$.__driftVsLegacy.latent') AS REAL))) AS max_abs_latent_pct
     FROM calculations
     WHERE calc_type = 'MANUAL_J'
       AND engine_version LIKE 'manualJ8-ts-%'
       AND engine_version NOT LIKE '%-fail'
       AND json_extract(outputs, '$.__driftVsLegacy.heat') IS NOT NULL
       AND created_at > datetime('now', '-30 days')`
  ).first();

  // Shadow-run reliability — successes vs failures over 30d. High
  // failure rate signals the cert-grade engine's construction registry
  // doesn't yet cover whatever climate / wall combos production users
  // are running.
  const shadowReliability = await db.prepare(
    `SELECT
       SUM(CASE WHEN engine_version LIKE 'manualJ8-ts-%' AND engine_version NOT LIKE '%-fail' THEN 1 ELSE 0 END) AS shadow_success,
       SUM(CASE WHEN engine_version LIKE '%-fail' THEN 1 ELSE 0 END) AS shadow_failure
     FROM calculations
     WHERE calc_type = 'MANUAL_J'
       AND created_at > datetime('now', '-30 days')`
  ).first();

  // ── Throwing-cause breakdown ───────────────────────────────────────────
  // Enumerate WHICH constructions / climate (CTD) bins the cert-grade engine
  // throws on, so the founder sees the known ceiling-CTD defect concretely
  // rather than a bare failure count. The throw message text lives in
  // outputs.__error and encodes the cause — e.g. "Manual J Table 4B: no
  // populated cell for CTD≥35, DR=H. ..." — so grouping by that text buckets
  // failures by their distinct root cause. Top-N capped to keep the payload
  // bounded; a long tail of one-off messages won't bloat the response.
  const { results: shadowFailureCauses } = await db.prepare(
    `SELECT
       COALESCE(json_extract(outputs, '$.__error'), '(no message)') AS cause,
       COUNT(*) AS count,
       COUNT(DISTINCT project_id) AS n_projects
     FROM calculations
     WHERE calc_type = 'MANUAL_J'
       AND engine_version LIKE '%-fail'
       AND created_at > datetime('now', '-30 days')
     GROUP BY cause
     ORDER BY count DESC, cause ASC
     LIMIT 15`
  ).all();

  // ── Static cert facts (travel with the build) ──────────────────────────
  // These are the published ACCA reference test results for the engine
  // version currently shipped. See docs/acca-validation-report.md for the
  // per-line-item breakdown. Bump these in lockstep with engine releases.
  //
  // 1.2.x (2026-07-15): ceiling CLTD family rows 16B/16C/16D (1.2.0, pp.
  // 362-363) and 16F (1.2.1, p. 364) transcribed from the physical book.
  // 1.3.0 (2026-07-15): Construction 19 floor PTD tables — climate-
  // dependent PTDH/PTDC (19B sealed/passive block, pp. 371-377) with the
  // printed-column-first / 5%-rule lookup convention; adapter now maps
  // floorRValue to the matching row. The 184/184 reference checks still
  // pass (CI-enforced; Smith bit-identical); the ACCA submission itself
  // was filed against 1.1.0 — recorded under `submission.filedEngineVersion`.
  const certification = {
    engineVersion: 'manualJ8-ts-1.3.0',
    standard: 'ACCA Manual J 8th Ed v2.50',
    suiteTolerance: 0.005,
    tests: [
      { name: 'Smith Residence',  passed: 70, total: 70, maxDriftPct: 0.006 },
      { name: 'Walker Residence', passed: 72, total: 72, maxDriftPct: 0.017 },
      { name: 'Cobb Residence',   passed: 42, total: 42, maxDriftPct: 0.0001 },
    ],
    aggregate: { passed: 184, total: 184 },
    frontendUnitTests: { passed: 123, total: 123, framework: 'vitest' },
    submission: {
      filed: true,
      filedAt: '2026-05-01',
      filedEngineVersion: 'manualJ8-ts-1.1.0',
      contact: 'Glenn Hourahan <glenn.hourahan@acca.org>',
      status: 'awaiting_review',
      slaMonths: 4,
    },
  };

  return c.json({
    certification,
    engineVersions,
    calcVolume,
    calcDuration,
    calcMix,
    auditVolume,
    shadowRunDrift: driftAgg,
    shadowRunReliability: shadowReliability,
    shadowRunFailureCauses: shadowFailureCauses,
    generatedAt: new Date().toISOString(),
  });
});

// ── L0 cross-tenant user management ────────────────────────────────────────
//
// These three endpoints let a platform admin act on a user inside ANY
// tenant — the normal `/api/org/users/:id` family is gated to the caller's
// own org. Useful for support workflows, fixing an all-admin tenant where
// no L1 admin is available, and the smoke-test of the audit log itself
// (every L0 action lands in the audit feed with `is_platform_action=1`
// and `target_org_id` set to the affected tenant).
//
// Important contract:
//   - The L0 admin canNOT remove themselves via this surface — they must
//     use the regular `/api/org/users/:id` flow inside their own tenant
//     (which has the last-admin guard).
//   - All three write audit rows that show up in BOTH the L0's audit feed
//     AND the affected tenant's tenant-scoped feed (target_org_id match).

// PATCH /api/platform/orgs/:orgId/users/:userId
// Body: { role?: 'admin'|'engineer'|'tech'|'viewer', isPermitAuthority?: boolean }
//
// Either field optional — pass one or both. Skip the same-tenant
// last-admin guard because L0 acting cross-tenant is the explicit
// recovery path for it.
platformRoutes.patch('/orgs/:orgId/users/:userId', async (c) => {
  const caller = c.get('user') as AuthUser;
  const orgId = c.req.param('orgId');
  const userId = c.req.param('userId');
  const body = await c.req.json();

  const target = await c.env.DB.prepare(
    `SELECT id, email, role, is_permit_authority, is_platform_admin, org_id
     FROM users WHERE id = ? AND org_id = ?`
  ).bind(userId, orgId).first();
  if (!target) return c.json({ error: 'User not found in that organisation' }, 404);

  // L0 cannot demote themselves via this path — too easy to accidentally
  // brick the platform-admin role. They go through their own tenant's
  // /team UI which has the last-admin guard.
  if (caller.id === userId) {
    return c.json({
      error: 'Use your own tenant\'s Team page to change your role. This endpoint is for cross-tenant operations.',
    }, 400);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  const after: Record<string, unknown> = {};

  if (typeof body.role === 'string') {
    if (!['admin', 'engineer', 'tech', 'viewer'].includes(body.role)) {
      return c.json({ error: 'Invalid role' }, 400);
    }
    updates.push('role = ?');
    values.push(body.role);
    after.role = body.role;
  }

  if (typeof body.isPermitAuthority === 'boolean') {
    updates.push('is_permit_authority = ?');
    values.push(body.isPermitAuthority ? 1 : 0);
    after.is_permit_authority = body.isPermitAuthority;
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  // Tenant-continuity guard also applies to L0 cross-tenant changes —
  // L0 bypasses capability *policy*, but stranding a tenant by removing
  // its last admin is never desirable. Only meaningful when a role is
  // actually changing (authority-flag-only edits don't affect continuity).
  if (typeof body.role === 'string') {
    const plan = await computeRoleChangePlan(c.env.DB, {
      orgId, targetUserId: userId, proposedRole: body.role,
    });
    if (plan && !plan.clear) {
      return c.json({
        error: 'Resolve the blocking consequences before this role change.',
        blockers: plan.blockers.filter((b) => b.severity === 'block'),
      }, 409);
    }
  }

  values.push(userId);
  await c.env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  setAudit(c, {
    action: 'platform.user.update',
    entityType: 'user',
    entityId: userId,
    entityLabel: target.email as string,
    targetOrgId: orgId,
    isPlatformAction: true,
    beforeValue: {
      role: target.role,
      is_permit_authority: Number(target.is_permit_authority ?? 0) === 1,
    },
    afterValue: after,
    detail: { fieldsChanged: Object.keys(after) },
  });

  return c.json({
    ok: true,
    role: 'role' in after ? after.role : target.role,
    isPermitAuthority: 'is_permit_authority' in after
      ? after.is_permit_authority
      : Number(target.is_permit_authority ?? 0) === 1,
  });
});

// DELETE /api/platform/orgs/:orgId/users/:userId
// L0-only soft-deactivate (non-destructive, changed 2026-05-15 — was a
// hard DELETE that silently orphaned created_by). Cannot deactivate
// yourself. Cannot deactivate the last ACTIVE member of a tenant — orgs
// need at least one reachable user. Reversible via the reactivate route.
platformRoutes.delete('/orgs/:orgId/users/:userId', async (c) => {
  const caller = c.get('user') as AuthUser;
  const orgId = c.req.param('orgId');
  const userId = c.req.param('userId');

  if (caller.id === userId) {
    return c.json({ error: 'You cannot remove yourself via this endpoint.' }, 400);
  }

  const target = await c.env.DB.prepare(
    `SELECT id, email, role, first_name, last_name, status FROM users WHERE id = ? AND org_id = ?`
  ).bind(userId, orgId).first();
  if (!target) return c.json({ error: 'User not found in that organisation' }, 404);

  // Count ACTIVE members — a tenant must keep at least one reachable user.
  const activeCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND status = 'active'`
  ).bind(orgId).first();
  if (Number(activeCount?.n ?? 0) <= 1) {
    return c.json({
      error: 'Cannot deactivate the last active member of an organisation.',
    }, 409);
  }

  // Finer-grained continuity guard (sole admin / sole permit authority)
  // — applies to L0 too; stranding a tenant is never desirable.
  const plan = await computeRoleChangePlan(c.env.DB, {
    orgId, targetUserId: userId, proposedRole: null,
  });
  if (plan && !plan.clear) {
    return c.json({
      error: 'Resolve the blocking consequences before deactivating this member.',
      blockers: plan.blockers.filter((b) => b.severity === 'block'),
    }, 409);
  }

  const r = await c.env.DB.prepare(
    `UPDATE users SET status = 'deactivated' WHERE id = ? AND status = 'active'`
  ).bind(userId).run();
  if (!r.meta.changes) {
    return c.json({ error: 'User not found or already deactivated' }, 404);
  }
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();

  setAudit(c, {
    action: 'platform.user.deactivate',
    entityType: 'user',
    entityId: userId,
    entityLabel: target.email as string,
    targetOrgId: orgId,
    isPlatformAction: true,
    beforeValue: { status: 'active', role: target.role },
    afterValue: { status: 'deactivated' },
    detail: { sessionsPurged: true },
  });

  return c.json({ ok: true, status: 'deactivated' });
});

// POST /api/platform/orgs/:orgId/users/:userId/reactivate — L0 reverse.
platformRoutes.post('/orgs/:orgId/users/:userId/reactivate', async (c) => {
  const orgId = c.req.param('orgId');
  const userId = c.req.param('userId');

  const target = await c.env.DB.prepare(
    `SELECT email, role, status FROM users WHERE id = ? AND org_id = ?`
  ).bind(userId, orgId).first();
  if (!target) return c.json({ error: 'User not found in that organisation' }, 404);

  const r = await c.env.DB.prepare(
    `UPDATE users SET status = 'active' WHERE id = ? AND status = 'deactivated'`
  ).bind(userId).run();
  if (!r.meta.changes) {
    return c.json({ error: 'User not found or already active' }, 404);
  }

  setAudit(c, {
    action: 'platform.user.reactivate',
    entityType: 'user',
    entityId: userId,
    entityLabel: target.email as string,
    targetOrgId: orgId,
    isPlatformAction: true,
    beforeValue: { status: 'deactivated' },
    afterValue: { status: 'active' },
  });

  return c.json({ ok: true, status: 'active' });
});

// ── L0 cross-tenant access-policy override ─────────────────────────────────
// The platform owner can set ANY tenant's compliance access policy. The
// tenant's own admin sets their policy via /api/org/access-policy; this
// is the L0 escape hatch for support / forced-compliance scenarios.
//
// GET returns the resolved policy for inspection; PUT patches it.
platformRoutes.get('/orgs/:orgId/access-policy', async (c) => {
  const orgId = c.req.param('orgId');
  const org = await c.env.DB.prepare(
    `SELECT id, name, settings FROM organisations WHERE id = ?`
  ).bind(orgId).first();
  if (!org) return c.json({ error: 'Organisation not found' }, 404);
  return c.json({
    orgId,
    orgName: org.name,
    policy: resolveAccessPolicy(org.settings),
  });
});

platformRoutes.put('/orgs/:orgId/access-policy', async (c) => {
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const patch = sanitizeAccessPolicyPatch(body);
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No valid policy fields (versionView|versionRestore|auditView → viewer|tech|engineer|admin).' }, 400);
  }

  const org = await c.env.DB.prepare(
    `SELECT name, settings FROM organisations WHERE id = ?`
  ).bind(orgId).first();
  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const before = resolveAccessPolicy(org.settings);
  const next = { ...before, ...patch };
  const merged = mergeAccessPolicyIntoSettings(org.settings, next);
  await c.env.DB.prepare(
    `UPDATE organisations SET settings = ? WHERE id = ?`
  ).bind(merged, orgId).run();

  setAudit(c, {
    action: 'platform.org.access_policy.update',
    entityType: 'organisation',
    entityId: orgId,
    entityLabel: org.name as string,
    targetOrgId: orgId,
    isPlatformAction: true,
    beforeValue: before as unknown as Record<string, unknown>,
    afterValue: next as unknown as Record<string, unknown>,
    detail: { fieldsChanged: Object.keys(patch) },
  });

  return c.json({ orgId, policy: next });
});

// ── Org impersonation ───────────────────────────────────────────────────────
//
// POST /api/platform/orgs/:orgId/impersonate
// Mints a 30-minute, ACCESS-ONLY, READ-ONLY session scoped to the target
// tenant (sessions.org_id = target, user_id = the L0 admin). No refresh
// token exists for it, so it cannot outlive its TTL. The read-only guard
// in index.ts blocks every mutation made under it. The client stashes the
// admin's real token pair and swaps back on exit / expiry.
platformRoutes.post('/orgs/:orgId/impersonate', async (c) => {
  const caller = c.get('user') as AuthUser;
  const orgId = c.req.param('orgId');

  // No chaining — an impersonation session cannot mint another one.
  // (Defense in depth: the index.ts guard already 403s this POST.)
  if (caller.isImpersonating) {
    return c.json({ error: 'Already impersonating a tenant. Exit first.' }, 400);
  }
  if (orgId === caller.orgId) {
    return c.json({ error: 'You are already a member of this organisation.' }, 400);
  }

  const org = await c.env.DB.prepare(
    `SELECT id, name, org_type, slug, region_code FROM organisations WHERE id = ?`
  ).bind(orgId).first();
  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const { accessToken, expiresAt } = await mintImpersonationSession(c.env.DB, caller.id, orgId);

  setAudit(c, {
    action: 'platform.org.impersonate',
    entityType: 'organisation',
    entityId: orgId,
    entityLabel: org.name as string,
    targetOrgId: orgId,
    isPlatformAction: true,
    detail: { expiresAt, readOnly: true },
  });

  return c.json({
    token: accessToken,
    expiresAt,
    organisation: {
      id: org.id, name: org.name, type: org.org_type,
      slug: org.slug, regionCode: org.region_code,
    },
  });
});

// POST /api/platform/impersonation/exit
// Deletes ONLY the current impersonation session row. Deliberately NOT
// /api/auth/logout — logout revokes ALL of the user's refresh tokens,
// which would kill the admin's real (stashed) session too. This is the
// single mutation the index.ts read-only guard allowlists.
platformRoutes.post('/impersonation/exit', async (c) => {
  const caller = c.get('user') as AuthUser;
  if (!caller.isImpersonating) {
    return c.json({ error: 'Not an impersonation session' }, 400);
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader!.slice(7); // authMiddleware already validated shape
  await c.env.DB.prepare(
    `DELETE FROM sessions WHERE token = ? AND is_impersonation = 1`
  ).bind(await hashToken(token)).run();

  setAudit(c, {
    action: 'platform.org.impersonate_exit',
    entityType: 'organisation',
    entityId: caller.orgId,
    targetOrgId: caller.orgId,
    isPlatformAction: true,
  });

  return c.json({ ok: true });
});

// ── GET /api/platform/me ────────────────────────────────────────────────────
// Sanity echo — confirms the caller is recognized as a platform admin and
// returns their user_id so the admin UI can label the session.
platformRoutes.get('/me', async (c) => {
  const user = c.get('user') as AuthUser;
  return c.json({
    id: user.id,
    email: user.email,
    role: user.role,
    isPlatformAdmin: user.isPlatformAdmin,
    orgId: user.orgId,
  });
});

// ── Feedback inbox — the READ side of the Mason feedback loop ─────────────────
// Users submit bug/idea/question from Mason (POST /api/feedback, org-scoped);
// this surfaces those submissions cross-tenant for L0 triage. org_id is
// intentionally UNSCOPED here — the acknowledged platform exception — so the
// creator can see everything landing across the platform, screenshots and all.

const FEEDBACK_TYPES = ['bug', 'suggestion', 'question'];
const FEEDBACK_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

/** Base64-encode an ArrayBuffer, chunked so a large buffer doesn't blow the
 *  String.fromCharCode argument limit. (Mirrors the helper in feedback.ts.) */
function feedbackBufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// GET /api/platform/feedback — filterable, cursor-paginated list + a queue tally.
platformRoutes.get('/feedback', async (c) => {
  const db = c.env.DB;
  const type = c.req.query('type');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const cursor = c.req.query('cursor');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (type && FEEDBACK_TYPES.includes(type)) { where.push('f.type = ?'); binds.push(type); }
  if (status && FEEDBACK_STATUSES.includes(status)) { where.push('f.status = ?'); binds.push(status); }
  if (cursor) { where.push('f.created_at < ?'); binds.push(cursor); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await db.prepare(
    `SELECT f.id, f.type, f.status, f.text, f.context, f.user_agent, f.created_at,
            f.org_id, o.name AS org_name,
            u.first_name, u.last_name, u.email AS user_email, u.role AS user_role,
            (SELECT COUNT(*) FROM feedback_attachments a WHERE a.feedback_id = f.id) AS attachment_count
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       JOIN organisations o ON o.id = f.org_id
       ${whereSql}
       ORDER BY f.created_at DESC
       LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = results as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (page[page.length - 1].created_at as string) : null;

  const counts = await db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN type = 'bug' THEN 1 ELSE 0 END) AS bugs,
       SUM(CASE WHEN type = 'suggestion' THEN 1 ELSE 0 END) AS ideas,
       SUM(CASE WHEN type = 'question' THEN 1 ELSE 0 END) AS questions
     FROM feedback`
  ).first();

  return c.json({ feedback: page, nextCursor, counts });
});

// GET /api/platform/feedback/:id — full record + attachments (images inlined
// as data URLs so the reviewer sees the screenshot without a second fetch).
platformRoutes.get('/feedback/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const feedback = await db.prepare(
    `SELECT f.*, o.name AS org_name,
            u.first_name, u.last_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       JOIN organisations o ON o.id = f.org_id
      WHERE f.id = ?`
  ).bind(id).first();
  if (!feedback) return c.json({ error: 'Not found' }, 404);

  const { results: attachRows } = await db.prepare(
    `SELECT id, r2_key, filename, content_type, size_bytes
       FROM feedback_attachments WHERE feedback_id = ?`
  ).bind(id).all();

  const MAX_INLINE = 6 * 1024 * 1024; // inline images up to 6 MB
  const attachments: Array<Record<string, unknown>> = [];
  for (const a of attachRows as Array<Record<string, unknown>>) {
    const contentType = (a.content_type as string) || '';
    const size = Number(a.size_bytes ?? 0);
    let dataUrl: string | null = null;
    if (contentType.startsWith('image/') && size > 0 && size <= MAX_INLINE) {
      const obj = await c.env.STORAGE.get(a.r2_key as string);
      if (obj) dataUrl = `data:${contentType};base64,${feedbackBufToBase64(await obj.arrayBuffer())}`;
    }
    attachments.push({
      id: a.id, filename: a.filename, content_type: a.content_type,
      size_bytes: a.size_bytes, dataUrl,
    });
  }

  return c.json({ feedback, attachments });
});

// PATCH /api/platform/feedback/:id — triage: move the status. Audited.
platformRoutes.patch('/feedback/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { status?: string };
  const status = body.status;
  if (!status || !FEEDBACK_STATUSES.includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  const existing = await db.prepare(
    'SELECT id, org_id, status, type, text FROM feedback WHERE id = ?'
  ).bind(id).first();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(status, id).run();

  setAudit(c, {
    action: 'platform.feedback.status',
    entityType: 'feedback',
    entityId: id,
    entityLabel: String(existing.text ?? '').slice(0, 80),
    targetOrgId: existing.org_id as string,
    isPlatformAction: true,
    beforeValue: { status: existing.status },
    afterValue: { status },
  });

  return c.json({ ok: true, status });
});
