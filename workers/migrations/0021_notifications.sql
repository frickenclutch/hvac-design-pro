-- 0021_notifications.sql — server-side notification events + per-member prefs.
--
-- WHY
-- The notification inbox shipped 2026-07-22 (bell, panel, org policy) had no
-- server-side event source. `notify.*` was called from exactly ONE place in the
-- frontend (App.tsx, access-level change); everything else in the panel was the
-- seeded welcome row. Every notification was therefore CLIENT-generated — it
-- could only describe something that happened in that tab, in front of that
-- user, about something they were already watching.
--
-- The consequence: an authority approving a permit, a teammate accepting an
-- invite, a calc landing from another device — none of these could ever reach
-- the user, on ANY transport. The bottleneck was never the delivery channel
-- (Web Push / VAPID / email); it was that nothing on the server ever raised an
-- event to deliver. This table is that event source.
--
-- Second gap closed here: the inbox lived in localStorage, so it was per-DEVICE.
-- Sign in on a phone and it was a different inbox; read-state never synced;
-- clearing browser data wiped the record. Rows here are the durable truth and
-- localStorage becomes a cache.
--
-- WHAT
-- notifications — one row per RECIPIENT (fan-out on write). A team event for an
--   org of N writes N rows. This keeps read-state trivially per-user (`read_at`)
--   and every query scoped by a single (org_id, user_id) pair. At current tenant
--   sizes the write amplification is irrelevant and the read path is one index.
--
--   kind      calc | permit | team | community | security | system
--             — matches NOTIFICATION_KINDS in utils/notificationPolicy.ts and
--               NotificationKind in the frontend store.
--   severity  info | success | warning | critical
--   href      in-app route to act on the notification (react-router path only —
--             never an absolute URL; the client navigates, it does not redirect).
--   read_at   NULL = unread. The unread badge counts these.
--   actor_user_id  who caused it; NULL for system/cron-raised events.
--
-- users.notification_prefs — the member's per-kind opt-in map, as JSON
--   ({"calc":true,...}). Previously localStorage-only, which was fine while
--   delivery was decided in the browser. Now that the SERVER decides whether a
--   row is written at all, the member's half of that decision has to live where
--   the decision is made — otherwise the same member gets different inboxes on
--   different devices. Resolution order is unchanged and still shared:
--   forced_off > forced_on > member preference (resolveDelivery).
--
-- NO FOREIGN KEYS — deliberate, following 0015's lesson.
--   A notification is a record of something that ALREADY happened. Tying it to
--   the continued existence of its subject inverts that: ON DELETE CASCADE would
--   silently destroy a user's inbox when an unrelated entity is removed (exactly
--   the 0018 cascade trap), and NO ACTION would block legitimate deletes the way
--   audit_log.project_id blocked project deletion until 0015. `href` may
--   therefore point at something that no longer exists — the client handles a
--   dead link by navigating and letting the target 404, which is correct: the
--   notification is still a true statement about the past.
--
-- org_id is NOT NULL and the table is registered in the tenant-scoping guard's
-- STRICT_TABLES — every query carries `org_id = ?` AND `user_id = ?` bound to
-- the session, never to client input.
--
-- CREATE TABLE IF NOT EXISTS / ADD COLUMN only — no rebuild, safe on re-apply.

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('calc', 'permit', 'team', 'community', 'security', 'system')),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'critical')),
    title TEXT NOT NULL,
    body TEXT,
    href TEXT,
    entity_type TEXT,
    entity_id TEXT,
    actor_user_id TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The inbox read: newest-first for one recipient. Covers the list query.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
    ON notifications(user_id, created_at DESC);

-- Unread-count + mark-all-read. Partial index — only unread rows are in it, so
-- it stays small no matter how much read history accumulates.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- Tenant sweeps and the retention trim.
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(org_id);

-- Member's per-kind opt-in map (JSON). NULL = never set = opt in to everything,
-- which is what defaultUserPrefs() has always returned client-side.
ALTER TABLE users ADD COLUMN notification_prefs TEXT;
