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
 * This file ships READ endpoints only. Impersonation, plan overrides, and
 * billing-status changes land in a follow-up unit so they get dedicated
 * audit + undo paths.
 */

import { Hono } from 'hono';
import { requirePlatformAdmin, type AuthUser } from '../middleware/auth';

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
//    currently shipped (manualJ8 v1.1.0). These travel with the build, not
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

  // ── Static cert facts (travel with the build) ──────────────────────────
  // These are the published ACCA reference test results for the engine
  // version currently shipped. See docs/acca-validation-report.md for the
  // per-line-item breakdown. Bump these in lockstep with engine releases.
  const certification = {
    engineVersion: 'manualJ8-ts-1.1.0',
    standard: 'ACCA Manual J 8th Ed v2.50',
    suiteTolerance: 0.005,
    tests: [
      { name: 'Smith Residence',  passed: 70, total: 70, maxDriftPct: 0.006 },
      { name: 'Walker Residence', passed: 72, total: 72, maxDriftPct: 0.017 },
      { name: 'Cobb Residence',   passed: 42, total: 42, maxDriftPct: 0.0001 },
    ],
    aggregate: { passed: 184, total: 184 },
    frontendUnitTests: { passed: 30, total: 30, framework: 'vitest' },
    submission: {
      filed: true,
      filedAt: '2026-05-01',
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
    generatedAt: new Date().toISOString(),
  });
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
