/**
 * Notification inbox — the member's own durable alert record.
 *
 * Every route here is scoped to the CALLER: `org_id = session.orgId AND
 * user_id = session.id`. There is no endpoint that reads or mutates another
 * member's inbox, not even for an admin — an admin governs which KINDS their
 * org receives (org.ts notification-policy), never what an individual has read
 * or dismissed. That separation is deliberate: policy is governance, an inbox
 * is correspondence.
 *
 * Mutations are BATCHED on purpose (`POST /read` takes ids or all) rather than
 * one request per row. Marking notifications read is a high-frequency, zero-
 * consequence action, and auditMiddleware logs every mutation — a per-row PATCH
 * would bury the audit log in `api.patch` rows for something no auditor cares
 * about. One request per user gesture keeps that volume proportionate.
 */

import { Hono } from 'hono';
import { setAudit } from '../middleware/audit';
import { resolveNotificationPolicy } from '../utils/notificationPolicy';
import {
  parseNotificationPrefs,
  serializeNotificationPrefs,
  sanitizeNotificationPrefsPatch,
  resolveDelivery,
  type NotificationPrefs,
} from '../utils/notifications';

interface Env {
  DB: D1Database;
}

export const notificationRoutes = new Hono<{ Bindings: Env }>();

/** Hard ceiling on a single page of the inbox. The client shows far fewer; this
 *  bounds a hand-crafted `?limit=100000` into something the edge can serve. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

interface NotificationRow {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  href: string | null;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Shape the wire response. `read` is a boolean for the client; `read_at` stays
 *  server-side detail. createdAt is epoch ms to match the existing store. */
function toWire(r: NotificationRow) {
  return {
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body ?? undefined,
    href: r.href ?? undefined,
    entityType: r.entity_type ?? undefined,
    entityId: r.entity_id ?? undefined,
    read: r.read_at !== null,
    createdAt: Date.parse(`${r.created_at.replace(' ', 'T')}Z`) || Date.now(),
  };
}

// ── GET /api/notifications ──────────────────────────────────────────────────
// The caller's inbox, newest first, with the unread count. Not audited (a GET
// with no semantic setAudit) — reading your own notifications is not an event.
notificationRoutes.get('/', async (c) => {
  const user = c.get('user');
  const raw = Number(c.req.query('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT;

  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, severity, title, body, href, entity_type, entity_id,
            actor_user_id, read_at, created_at
     FROM notifications
     WHERE org_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(user.orgId, user.id, limit).all();

  const rows = (results ?? []) as unknown as NotificationRow[];

  // Counted server-side rather than derived from the page — the badge must be
  // right even when there are more unread than the page holds.
  const unreadRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM notifications
     WHERE org_id = ? AND user_id = ? AND read_at IS NULL`
  ).bind(user.orgId, user.id).first();

  return c.json({
    notifications: rows.map(toWire),
    unread: Number(unreadRow?.n ?? 0),
  });
});

// ── POST /api/notifications/read ────────────────────────────────────────────
// Mark specific ids, or everything, as read. Batched — see the file header.
notificationRoutes.post('/read', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as { ids?: unknown; all?: unknown };

  if (body.all === true) {
    const res = await c.env.DB.prepare(
      `UPDATE notifications SET read_at = datetime('now')
       WHERE org_id = ? AND user_id = ? AND read_at IS NULL`
    ).bind(user.orgId, user.id).run();
    setAudit(c, {
      action: 'notification.read_all',
      entityType: 'notification',
      detail: { count: res.meta?.changes ?? 0 },
    });
    return c.json({ updated: res.meta?.changes ?? 0 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string').slice(0, MAX_LIMIT)
    : [];
  if (ids.length === 0) {
    return c.json({ error: 'Provide { ids: string[] } or { all: true }' }, 400);
  }

  // The org_id + user_id predicate is what makes a guessed id harmless: an id
  // belonging to anyone else simply matches zero rows.
  const placeholders = ids.map(() => '?').join(', ');
  const res = await c.env.DB.prepare(
    `UPDATE notifications SET read_at = datetime('now')
     WHERE org_id = ? AND user_id = ? AND read_at IS NULL
       AND id IN (${placeholders})`
  ).bind(user.orgId, user.id, ...ids).run();

  setAudit(c, {
    action: 'notification.read',
    entityType: 'notification',
    detail: { requested: ids.length, updated: res.meta?.changes ?? 0 },
  });
  return c.json({ updated: res.meta?.changes ?? 0 });
});

// ── DELETE /api/notifications/:id ───────────────────────────────────────────
notificationRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const res = await c.env.DB.prepare(
    `DELETE FROM notifications WHERE org_id = ? AND user_id = ? AND id = ?`
  ).bind(user.orgId, user.id, id).run();

  if ((res.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'Notification not found' }, 404);
  }
  setAudit(c, { action: 'notification.dismiss', entityType: 'notification', entityId: id });
  return c.json({ dismissed: 1 });
});

// ── DELETE /api/notifications ───────────────────────────────────────────────
// Clear the caller's whole inbox.
notificationRoutes.delete('/', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare(
    `DELETE FROM notifications WHERE org_id = ? AND user_id = ?`
  ).bind(user.orgId, user.id).run();

  setAudit(c, {
    action: 'notification.clear_all',
    entityType: 'notification',
    detail: { count: res.meta?.changes ?? 0 },
  });
  return c.json({ cleared: res.meta?.changes ?? 0 });
});

// ── GET /api/notifications/preferences ──────────────────────────────────────
// The member's per-kind opt-ins, the org policy that constrains them, and the
// resolved effective delivery. Returning all three lets Settings render a
// locked row with an honest reason instead of a toggle that silently does
// nothing when the org has forced the kind on or off.
notificationRoutes.get('/preferences', async (c) => {
  const user = c.get('user');

  const row = await c.env.DB.prepare(
    `SELECT u.notification_prefs, o.settings
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.id = ? AND u.org_id = ?`
  ).bind(user.id, user.orgId).first();

  const prefs = parseNotificationPrefs(row?.notification_prefs);
  const policy = resolveNotificationPolicy(row?.settings);
  const effective = Object.fromEntries(
    Object.entries(policy).map(([k, mode]) => [
      k, resolveDelivery(mode, prefs[k as keyof NotificationPrefs]),
    ]),
  );

  return c.json({ prefs, policy, effective });
});

// ── PUT /api/notifications/preferences ──────────────────────────────────────
// Partial update of the caller's own per-kind opt-ins. Always binds the session
// user — there is no path to write another member's preferences.
notificationRoutes.put('/preferences', async (c) => {
  const user = c.get('user');
  const patch = sanitizeNotificationPrefsPatch(await c.req.json().catch(() => ({})));
  if (Object.keys(patch).length === 0) {
    return c.json({
      error: 'No valid preference fields. Expected { kind: boolean } where kind ∈ calc|permit|team|community|security|system.',
    }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT u.notification_prefs, o.settings
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.id = ? AND u.org_id = ?`
  ).bind(user.id, user.orgId).first();

  const before = parseNotificationPrefs(row?.notification_prefs);
  const next = { ...before, ...patch };

  await c.env.DB.prepare(
    `UPDATE users SET notification_prefs = ? WHERE id = ? AND org_id = ?`
  ).bind(serializeNotificationPrefs(next), user.id, user.orgId).run();

  setAudit(c, {
    action: 'notification.preferences.update',
    entityType: 'user',
    entityId: user.id,
    beforeValue: before as unknown as Record<string, unknown>,
    afterValue: next as unknown as Record<string, unknown>,
    detail: { fieldsChanged: Object.keys(patch) },
  });

  const policy = resolveNotificationPolicy(row?.settings);
  const effective = Object.fromEntries(
    Object.entries(policy).map(([k, mode]) => [
      k, resolveDelivery(mode, next[k as keyof NotificationPrefs]),
    ]),
  );
  return c.json({ prefs: next, policy, effective });
});
