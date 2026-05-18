/**
 * Audit logging — the platform's accountability spine.
 *
 * Two layers of capture:
 *
 *  1. AUTOMATIC (this middleware) — every authenticated mutation request
 *     (POST/PUT/PATCH/DELETE) is logged with HTTP-level metadata: method,
 *     path, status, duration, IP, user agent. This guarantees coverage even
 *     if a handler forgets to call `setAudit`. Failures (5xx, network errors
 *     thrown from the handler) are still logged so we can see them later.
 *
 *  2. SEMANTIC (handlers call `setAudit`) — handlers enrich the pending
 *     audit row with semantic action ("project.create"), entity type+id,
 *     a human-readable label, before/after snapshots for edits, etc.
 *     The middleware writes ONE row per request combining everything.
 *
 * GETs are NOT logged by default — they would explode storage. Sensitive
 * reads (e.g. an L0 admin viewing a tenant's data) opt in by calling
 * `setAudit({ action: 'platform.org.view', ... })` from the handler.
 *
 * Audit writes never block or break the response — wrapped in try/catch and
 * errors are console.error'd but swallowed.
 */

import type { Context, Next, MiddlewareHandler } from 'hono';
import type { AuthUser } from './auth';

export interface AuditDetail {
  /** Semantic verb. Convention: "{entity}.{action}" e.g. "project.create",
   *  "user.role_changed", "permit.approved". For automatic logs the action
   *  defaults to "api.{method.lower()}" so they're filterable separately. */
  action?: string;
  /** Plural name of the entity type for filtering ("project", "user",
   *  "calculation", "permit_submission", "organisation", "cad_drawing"). */
  entityType?: string;
  /** Primary key of the affected entity. */
  entityId?: string;
  /** Human-readable name. Denormalized so the audit row stays useful
   *  after the entity is deleted. */
  entityLabel?: string;
  /** Project context for entity types nested under a project. Lets the
   *  per-project audit-log query join cleanly. */
  projectId?: string;
  /** When the action affects an org OTHER than the actor's. Used for L0
   *  admin actions, Permit Authority decisions on submitter projects, and
   *  Community comment posts on another tenant's public project. */
  targetOrgId?: string;
  /** Free-form structured detail — anything not covered by the typed
   *  fields. Stored as JSON. Avoid putting PII or secrets here. */
  detail?: Record<string, unknown> | string;
  /** Pre-mutation state snapshot for edits. Useful for diff rendering. */
  beforeValue?: Record<string, unknown> | string;
  /** Post-mutation state snapshot. */
  afterValue?: Record<string, unknown> | string;
  /** True when the actor used L0 platform-admin powers (cross-tenant). */
  isPlatformAction?: boolean;
}

interface PendingAudit extends AuditDetail {
  /** Set true once a handler has explicitly populated the row, so the
   *  middleware can decide whether to log GETs and how to label rows. */
  semantic?: boolean;
}

/** Handlers call this to enrich the pending audit row. Safe to call
 *  multiple times — fields merge, last-wins. */
export function setAudit(c: Context, audit: AuditDetail): void {
  const pending = c.get('pendingAudit') as PendingAudit | undefined;
  if (!pending) return;
  Object.assign(pending, audit, { semantic: true });
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The middleware factory. Mount AFTER `authMiddleware` so user is set. */
export function auditMiddleware(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    const pending: PendingAudit = {};
    c.set('pendingAudit', pending);

    let thrown: unknown = null;
    try {
      await next();
    } catch (err) {
      thrown = err;
      // Re-throw after we've recorded the failure
    }

    const method = c.req.method;
    const path = new URL(c.req.url).pathname;
    const status = thrown ? 500 : c.res?.status ?? 200;
    const isMutation = MUTATION_METHODS.has(method);
    const hasSemantic = !!pending.semantic;

    // Skip GETs that handlers didn't explicitly mark for audit. Skip
    // OPTIONS (CORS preflight). Always log mutations even without semantic
    // detail so we have at least the HTTP envelope.
    const shouldLog =
      hasSemantic ||
      (isMutation && method !== 'OPTIONS');

    if (shouldLog) {
      try {
        await writeAuditRow(c, pending, {
          method,
          path,
          status,
          durationMs: Date.now() - start,
        });
      } catch (e) {
        console.error('[audit] write failed:', e);
      }
    }

    if (thrown) throw thrown;
  };
}

interface HttpEnvelope {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

async function writeAuditRow(
  c: Context,
  audit: PendingAudit,
  http: HttpEnvelope,
): Promise<void> {
  const db = c.env.DB as D1Database;
  if (!db) return;

  const user = c.get('user') as AuthUser | undefined;
  const id = crypto.randomUUID();
  const requestId = c.req.header('cf-ray') ?? null;
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    null;
  const ua = c.req.header('user-agent')?.slice(0, 500) ?? null;

  const action = audit.action ?? `api.${http.method.toLowerCase()}`;
  const stringify = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v.slice(0, 50000);
    try {
      return JSON.stringify(v).slice(0, 50000);
    } catch {
      return null;
    }
  };

  await db.prepare(
    `INSERT INTO audit_log
       (id, org_id, user_id, project_id, action, entity_type, entity_id,
        entity_label, target_org_id, detail, before_value, after_value,
        method, path, status_code, duration_ms, ip_address, user_agent,
        actor_role, is_platform_action, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    user?.orgId ?? null,
    user?.id ?? null,
    audit.projectId ?? null,
    action,
    audit.entityType ?? null,
    audit.entityId ?? null,
    audit.entityLabel?.slice(0, 200) ?? null,
    audit.targetOrgId ?? null,
    stringify(audit.detail),
    stringify(audit.beforeValue),
    stringify(audit.afterValue),
    http.method,
    http.path.slice(0, 500),
    http.status,
    http.durationMs,
    ip,
    ua,
    user?.role ?? null,
    audit.isPlatformAction ? 1 : 0,
    requestId,
  ).run();
}

/**
 * Standalone audit writer for the AUTH routes.
 *
 * `/api/auth/*` is mounted BEFORE `auditMiddleware` (you can't require a
 * valid session to log in), so login / logout / register / invite-redeem
 * / password-reset / SSO never hit the auto-logger and produced NO audit
 * trail at all — a SOC 2 CC7.2 hole exactly where auditors look first.
 *
 * This function writes a row directly with explicit identity (the handler
 * resolves the user itself after authenticating). It never throws — an
 * audit failure must not break a login. `userId` / `orgId` may be null
 * for pre-identity events (failed login, unknown-email reset request).
 */
export async function writeAuthAudit(
  c: Context,
  ev: {
    action: string;            // e.g. "auth.login", "auth.login.failed"
    userId?: string | null;
    orgId?: string | null;
    actorRole?: string | null;
    entityType?: string;       // usually "user"
    entityId?: string | null;
    entityLabel?: string | null;  // email — denormalized, survives deletion
    status: number;            // HTTP status the handler is returning
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const db = c.env.DB as D1Database;
    if (!db) return;
    const id = crypto.randomUUID();
    const requestId = c.req.header('cf-ray') ?? null;
    const ip =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-real-ip') ??
      null;
    const ua = c.req.header('user-agent')?.slice(0, 500) ?? null;
    const path = new URL(c.req.url).pathname;
    const detailStr = ev.detail
      ? (() => { try { return JSON.stringify(ev.detail).slice(0, 50000); } catch { return null; } })()
      : null;

    await db.prepare(
      `INSERT INTO audit_log
         (id, org_id, user_id, project_id, action, entity_type, entity_id,
          entity_label, target_org_id, detail, before_value, after_value,
          method, path, status_code, duration_ms, ip_address, user_agent,
          actor_role, is_platform_action, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      ev.orgId ?? null,
      ev.userId ?? null,
      null,
      ev.action,
      ev.entityType ?? 'user',
      ev.entityId ?? null,
      ev.entityLabel?.slice(0, 200) ?? null,
      null,
      detailStr,
      null,
      null,
      c.req.method,
      path.slice(0, 500),
      ev.status,
      null,
      ip,
      ua,
      ev.actorRole ?? null,
      0,
      requestId,
    ).run();
  } catch (e) {
    console.error('[audit] auth-event write failed:', e);
  }
}
