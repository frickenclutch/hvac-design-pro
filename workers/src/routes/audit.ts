/**
 * /api/audit-log/* — read access to the platform's audit log.
 *
 * Two scopes are supported off the same handler tree:
 *
 *   - TENANT scope (default): caller sees actions where their org is the
 *     actor (`org_id = caller.orgId`) or the target (`target_org_id =
 *     caller.orgId`). Visible to any authenticated user; admins see the
 *     full feed, non-admins see only their own actions plus actions taken
 *     against entities they own. This is the "audit trail" surface for
 *     regular tenants.
 *
 *   - L0 PLATFORM scope: when a platform admin passes `?scope=platform`,
 *     they see every row in the table. This is gated server-side by
 *     `is_platform_admin`. Without the flag, scope=platform falls through
 *     to tenant scope.
 *
 * Filters supported (all optional, additive):
 *   - userId        — restrict to one actor
 *   - entityType    — "project", "user", "calculation", "permit_submission"
 *   - entityId      — drill-through, often combined with entityType
 *   - action        — "project.create", supports prefix match with "*"
 *   - orgId         — L0 only; restricts feed to one tenant
 *   - since         — ISO timestamp lower bound
 *   - limit         — default 100, capped at 500
 *   - cursor        — opaque pagination token (the last row's id+created_at)
 *
 * Response shape carries enough for drill-through links:
 *   - org_name, target_org_name (for cross-tenant rows)
 *   - actor email + name (denormalized at read time, not write)
 *   - entity_label (denormalized at write time, survives entity deletion)
 *   - parsed JSON for detail/before_value/after_value
 */

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth';
import { resolveAccessPolicy, roleSatisfies } from '../utils/accessPolicy';

interface Env { DB: D1Database; }

export const auditRoutes = new Hono<{ Bindings: Env }>();

// Every audit-log endpoint is gated by the org's `auditView` policy
// (default: admin + L0 only — it's a compliance/oversight tool, not a
// working tool). Below threshold the endpoint 403s entirely; it does NOT
// degrade to "your own rows" — that's a deliberate product decision so
// observers don't even see the surface exists.
auditRoutes.use('*', async (c, next) => {
  const user = c.get('user') as AuthUser;
  const org = await c.env.DB.prepare(
    `SELECT settings FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();
  const policy = resolveAccessPolicy(org?.settings);
  if (!roleSatisfies(user.role, policy.auditView, user.isPlatformAdmin)) {
    return c.json({ error: 'Your role does not have access to the audit log.' }, 403);
  }
  await next();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseJSONIfPossible(v: unknown): unknown {
  if (typeof v !== 'string' || !v) return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
}

/** Decorate a row with parsed JSON columns + a stable shape. The DB row is
 *  already join-enriched with org / user / target_org names. */
function shapeRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    createdAt: r.created_at,
    action: r.action,
    method: r.method,
    path: r.path,
    statusCode: r.status_code,
    durationMs: r.duration_ms,
    actor: {
      userId: r.user_id,
      orgId: r.org_id,
      role: r.actor_role,
      email: r.user_email,
      firstName: r.user_first_name,
      lastName: r.user_last_name,
      orgName: r.org_name,
      isPlatformAction: Number(r.is_platform_action ?? 0) === 1,
    },
    target: {
      orgId: r.target_org_id ?? null,
      orgName: r.target_org_name ?? null,
    },
    entity: {
      type: r.entity_type ?? null,
      id: r.entity_id ?? null,
      label: r.entity_label ?? null,
      projectId: r.project_id ?? null,
    },
    detail: parseJSONIfPossible(r.detail),
    beforeValue: parseJSONIfPossible(r.before_value),
    afterValue: parseJSONIfPossible(r.after_value),
    network: {
      ip: r.ip_address ?? null,
      userAgent: r.user_agent ?? null,
      requestId: r.request_id ?? null,
    },
  };
}

/** Build the join + WHERE for a feed query. Both tenant and L0 scope share
 *  the same SELECT; only the WHERE differs. */
function selectClause(): string {
  return `
    SELECT a.id, a.org_id, a.user_id, a.project_id, a.action, a.entity_type,
           a.entity_id, a.entity_label, a.target_org_id, a.detail,
           a.before_value, a.after_value, a.method, a.path, a.status_code,
           a.duration_ms, a.ip_address, a.user_agent, a.actor_role,
           a.is_platform_action, a.request_id, a.created_at,
           o.name AS org_name,
           t.name AS target_org_name,
           u.email AS user_email,
           u.first_name AS user_first_name,
           u.last_name AS user_last_name
    FROM audit_log a
    LEFT JOIN organisations o ON o.id = a.org_id
    LEFT JOIN organisations t ON t.id = a.target_org_id
    LEFT JOIN users u ON u.id = a.user_id
  `;
}

/** Distinct action verbs we have rows for — used to populate the filter
 *  dropdown in the audit log UI. Scope-aware. */
auditRoutes.get('/actions', async (c) => {
  const user = c.get('user') as AuthUser;
  const scope = c.req.query('scope');
  const isL0 = scope === 'platform' && user.isPlatformAdmin;

  const where = isL0
    ? '1=1'
    : '(a.org_id = ? OR a.target_org_id = ?)';
  const params = isL0 ? [] : [user.orgId, user.orgId];

  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT action FROM audit_log a WHERE ${where} ORDER BY action`
  ).bind(...params).all();

  return c.json({ actions: results.map((r) => r.action as string) });
});

// ── GET /api/audit-log ──────────────────────────────────────────────────────
auditRoutes.get('/', async (c) => {
  const user = c.get('user') as AuthUser;
  const scope = c.req.query('scope');
  const isL0 = scope === 'platform' && user.isPlatformAdmin;

  const userId = c.req.query('userId');
  const entityType = c.req.query('entityType');
  const entityId = c.req.query('entityId');
  const projectId = c.req.query('projectId');
  const action = c.req.query('action');
  const orgIdFilter = c.req.query('orgId');
  const since = c.req.query('since');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500);
  const cursor = c.req.query('cursor');

  const where: string[] = [];
  const params: unknown[] = [];

  // Scope: L0 sees everything; tenant sees rows where they're actor or target.
  // Non-admin tenant users see only their own actions, plus actions targeting
  // entities they created (via projectId join — but that's expensive; for v1
  // we just gate the page-level access at admin-only and let admins see all
  // tenant rows).
  if (isL0) {
    if (orgIdFilter) {
      where.push('(a.org_id = ? OR a.target_org_id = ?)');
      params.push(orgIdFilter, orgIdFilter);
    }
  } else {
    // Tenant scope. Admins see the org-wide feed; non-admins see only
    // their own actions.
    if (user.role === 'admin') {
      where.push('(a.org_id = ? OR a.target_org_id = ?)');
      params.push(user.orgId, user.orgId);
    } else {
      where.push('a.user_id = ?');
      params.push(user.id);
    }
  }

  if (userId) {
    where.push('a.user_id = ?');
    params.push(userId);
  }
  if (entityType) {
    where.push('a.entity_type = ?');
    params.push(entityType);
  }
  if (entityId) {
    where.push('a.entity_id = ?');
    params.push(entityId);
  }
  if (projectId) {
    where.push('a.project_id = ?');
    params.push(projectId);
  }
  if (action) {
    if (action.endsWith('*')) {
      where.push('a.action LIKE ?');
      params.push(action.slice(0, -1) + '%');
    } else {
      where.push('a.action = ?');
      params.push(action);
    }
  }
  if (since) {
    where.push('a.created_at >= ?');
    params.push(since);
  }
  if (cursor) {
    // Cursor is "createdAt|id" — strict-less keep-set pagination.
    const [cAt, cId] = cursor.split('|');
    if (cAt && cId) {
      where.push('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))');
      params.push(cAt, cAt, cId);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `${selectClause()}
     ${whereSql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ?`
  ).bind(...params, limit).all();

  const events = (results as Array<Record<string, unknown>>).map(shapeRow);
  const last = events[events.length - 1];
  const nextCursor =
    events.length === limit && last
      ? `${last.createdAt}|${last.id}`
      : null;

  return c.json({
    events,
    scope: isL0 ? 'platform' : 'tenant',
    nextCursor,
    limit,
  });
});

// ── GET /api/audit-log/entity/:type/:id ─────────────────────────────────────
// Convenience: fetch the audit history of one entity. Useful for the
// per-project / per-user activity tab. Tenant scope automatic; if the
// entity belongs to another tenant, only L0 admins see it.
auditRoutes.get('/entity/:type/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const type = c.req.param('type');
  const id = c.req.param('id');

  const where = ['a.entity_type = ?', 'a.entity_id = ?'];
  const params: unknown[] = [type, id];

  if (!user.isPlatformAdmin) {
    where.push('(a.org_id = ? OR a.target_org_id = ?)');
    params.push(user.orgId, user.orgId);
  }

  const { results } = await c.env.DB.prepare(
    `${selectClause()}
     WHERE ${where.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT 200`
  ).bind(...params).all();

  return c.json({
    events: (results as Array<Record<string, unknown>>).map(shapeRow),
    entityType: type,
    entityId: id,
  });
});

// ── GET /api/audit-log/:id ──────────────────────────────────────────────────
// Single audit row, parsed. Used by the row-detail drawer.
auditRoutes.get('/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    `${selectClause()} WHERE a.id = ?`
  ).bind(id).first();

  if (!row) return c.json({ error: 'Audit event not found' }, 404);

  // Visibility check: caller must be in the actor org, target org, or be L0.
  const visible =
    user.isPlatformAdmin ||
    row.org_id === user.orgId ||
    row.target_org_id === user.orgId ||
    row.user_id === user.id;
  if (!visible) return c.json({ error: 'Audit event not found' }, 404);

  return c.json({ event: shapeRow(row as Record<string, unknown>) });
});
