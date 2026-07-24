/**
 * Notification emission — the server-side event source.
 *
 * Before this existed, notifications were raised in the browser, which meant a
 * notification could only describe something that happened in front of the user
 * who was being notified. That is backwards: the events worth alerting on are
 * precisely the ones you AREN'T watching — an authority approving your permit,
 * a teammate accepting an invite, a calc finishing on another device.
 *
 * Handlers call `notifyUser` / `notifyOrg` at the same points they call
 * `setAudit`. The audit row records what happened for the operator; the
 * notification row tells the affected human. They are deliberately separate:
 * audit is complete and forensic, notifications are selective and addressed.
 *
 * ── The delivery gate ───────────────────────────────────────────────────────
 * A row is written only if `resolveDelivery(orgPolicyMode, memberPref)` says so:
 *   forced_off  → never written, for anyone in the org
 *   forced_on   → always written, member cannot opt out
 *   user_choice → the member's own per-kind preference decides
 * This is the SAME resolution the frontend has always used; it simply moved to
 * where the decision is now made. A gated-out notification is never persisted —
 * we don't write rows we intend to hide, because a hidden row is still a row
 * that leaks activity through a count or an export.
 *
 * ── Failure contract ────────────────────────────────────────────────────────
 * Emission NEVER breaks the request that triggered it. Every entry point is
 * wrapped; failures are console.error'd and swallowed, exactly like audit
 * writes. Losing a notification is a bad day; failing a permit approval because
 * the notification insert threw is a worse one.
 */

import {
  NOTIFICATION_KINDS,
  resolveNotificationPolicy,
  type NotificationKind,
  type PolicyMode,
  type NotificationPolicy,
} from './notificationPolicy';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

/** Per-kind member opt-in. Absent/malformed keys default to true — the member
 *  has opted in to everything until they say otherwise. */
export type NotificationPrefs = Record<NotificationKind, boolean>;

export function defaultNotificationPrefs(): NotificationPrefs {
  return {
    calc: true, permit: true, team: true,
    community: true, security: true, system: true,
  };
}

/**
 * The single source of truth for "does this member receive this kind?".
 * Mirrors `resolveDelivery` in the frontend store — kept as a pure function on
 * both sides so the same rule is unit-testable independently of transport.
 */
export function resolveDelivery(mode: PolicyMode, userPref: boolean): boolean {
  if (mode === 'forced_off') return false;
  if (mode === 'forced_on') return true;
  return userPref;
}

/** Parse a `users.notification_prefs` JSON blob. Never throws; unknown or
 *  malformed values fall back to the default for that kind. */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  const prefs = defaultNotificationPrefs();
  if (typeof raw !== 'string' || !raw.trim()) return prefs;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const k of NOTIFICATION_KINDS) {
      if (typeof parsed[k] === 'boolean') prefs[k] = parsed[k] as boolean;
    }
  } catch { /* keep defaults */ }
  return prefs;
}

/** Serialize a prefs map for storage, keeping only known kinds. */
export function serializeNotificationPrefs(prefs: Partial<NotificationPrefs>): string {
  const out: Record<string, boolean> = {};
  for (const k of NOTIFICATION_KINDS) {
    if (typeof prefs[k] === 'boolean') out[k] = prefs[k] as boolean;
  }
  return JSON.stringify(out);
}

/** Validate + normalize an incoming prefs patch from a member. Returns only the
 *  kinds that were present AND boolean; callers merge over the stored map so a
 *  partial PUT changes only what was sent. */
export function sanitizeNotificationPrefsPatch(body: unknown): Partial<NotificationPrefs> {
  const out: Partial<NotificationPrefs> = {};
  if (!body || typeof body !== 'object') return out;
  const b = body as Record<string, unknown>;
  const src = (b.prefs && typeof b.prefs === 'object') ? b.prefs as Record<string, unknown> : b;
  for (const [key, val] of Object.entries(src)) {
    if ((NOTIFICATION_KINDS as string[]).includes(key) && typeof val === 'boolean') {
      out[key as NotificationKind] = val;
    }
  }
  return out;
}

/** What a caller supplies to raise a notification. */
export interface NotificationInput {
  /** Owning tenant. Always the SESSION org (or, for cross-tenant events like a
   *  permit decision, the RECIPIENT's org — never a client-supplied id). */
  orgId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** In-app react-router path (e.g. `/permits/abc`). Relative paths only —
   *  rejected otherwise, so a notification can never become an open redirect. */
  href?: string;
  severity?: NotificationSeverity;
  entityType?: string;
  entityId?: string;
  /** Who caused it. NULL for cron/system-raised events. */
  actorUserId?: string | null;
}

const MAX_TITLE = 200;
const MAX_BODY = 1000;
const MAX_HREF = 500;

/**
 * Only same-origin, in-app paths are storable. A notification href is fed
 * straight into `navigate()`, so accepting an absolute URL would turn any
 * emission point into a redirect primitive. Protocol-relative `//evil.com` is
 * rejected too — it is an absolute URL wearing a relative costume.
 */
function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  return trimmed.slice(0, MAX_HREF);
}

function buildRow(input: NotificationInput, userId: string) {
  return {
    id: crypto.randomUUID(),
    orgId: input.orgId,
    userId,
    kind: input.kind,
    severity: input.severity ?? 'info',
    title: input.title.slice(0, MAX_TITLE),
    body: input.body?.slice(0, MAX_BODY) ?? null,
    href: safeHref(input.href),
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    actorUserId: input.actorUserId ?? null,
  };
}

/**
 * The one place a notification row is written.
 *
 * The SQL is written INLINE here rather than hoisted into a shared constant:
 * the tenant-scoping guard reads prepared statements statically and cannot see
 * through a variable, so a hoisted constant would make this INSERT opaque to
 * the very check that exists to catch an unscoped write. Routing both callers
 * through one function keeps it machine-checkable — `org_id` is right there in
 * the statement text.
 */
function insertStatement(db: D1Database, r: ReturnType<typeof buildRow>): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO notifications
       (id, org_id, user_id, kind, severity, title, body, href,
        entity_type, entity_id, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    r.id, r.orgId, r.userId, r.kind, r.severity,
    r.title, r.body, r.href, r.entityType, r.entityId, r.actorUserId,
  );
}

/** Fetch and resolve one org's notification policy. */
async function policyFor(db: D1Database, orgId: string): Promise<NotificationPolicy> {
  const org = await db.prepare(
    `SELECT settings FROM organisations WHERE id = ?`
  ).bind(orgId).first();
  return resolveNotificationPolicy(org?.settings);
}

/**
 * The outcome of a single-recipient emission.
 *
 * `suppressed` and `no_recipient` are deliberately distinct. They look the same
 * from the caller's side — no row was written — but they mean opposite things,
 * and a caller with a fallback path must not confuse them: escalating to an
 * admin because the intended recipient is DEACTIVATED is correct, while
 * escalating because they exercised their preference and muted the kind routes
 * around that preference to their boss. A boolean return invited exactly that
 * bug; this type makes it unrepresentable.
 */
export type EmitResult = 'delivered' | 'suppressed' | 'no_recipient' | 'error';

/**
 * Raise a notification for ONE recipient.
 *
 * `userId` must be a server-derived id (a session user, a project's owner, a
 * submission's submitter) — never a value read off the request body.
 */
export async function notifyUser(
  db: D1Database,
  userId: string,
  input: NotificationInput,
): Promise<EmitResult> {
  try {
    // The recipient must be a live member of the org we're writing the row
    // under. This is the tenant check: it makes it impossible to address a
    // notification into another tenant by passing a mismatched (orgId, userId).
    const recipient = await db.prepare(
      `SELECT notification_prefs FROM users
       WHERE id = ? AND org_id = ? AND status = 'active'`
    ).bind(userId, input.orgId).first();
    if (!recipient) return 'no_recipient';

    const policy = await policyFor(db, input.orgId);
    const prefs = parseNotificationPrefs(recipient.notification_prefs);
    if (!resolveDelivery(policy[input.kind], prefs[input.kind])) return 'suppressed';

    await insertStatement(db, buildRow(input, userId)).run();
    return 'delivered';
  } catch (e) {
    console.error('[notify] user emission failed:', e);
    return 'error';
  }
}

export interface NotifyOrgOptions {
  /** Skip this recipient — normally the actor, who doesn't need telling about
   *  their own action. */
  excludeUserId?: string | null;
  /** Restrict to these roles (e.g. ['admin'] for governance events). Omit for
   *  every active member. */
  roles?: string[];
}

/**
 * Fan out a notification to the active members of an org.
 *
 * One policy read + one recipient read + one batched insert, regardless of org
 * size. Returns the number of rows written.
 */
export async function notifyOrg(
  db: D1Database,
  input: NotificationInput,
  options: NotifyOrgOptions = {},
): Promise<number> {
  try {
    const policy = await policyFor(db, input.orgId);
    // Cheap exit: a forced_off kind can't reach anyone, so don't even read the
    // member list. (forced_on / user_choice still need per-member prefs.)
    if (policy[input.kind] === 'forced_off') return 0;

    const { results } = await db.prepare(
      `SELECT id, notification_prefs FROM users
       WHERE org_id = ? AND status = 'active'`
    ).bind(input.orgId).all();

    const roleFiltered = options.roles?.length
      ? await filterByRole(db, input.orgId, options.roles)
      : null;

    const statements: D1PreparedStatement[] = [];
    for (const row of results ?? []) {
      const userId = row.id as string;
      if (options.excludeUserId && userId === options.excludeUserId) continue;
      if (roleFiltered && !roleFiltered.has(userId)) continue;

      const prefs = parseNotificationPrefs(row.notification_prefs);
      if (!resolveDelivery(policy[input.kind], prefs[input.kind])) continue;

      statements.push(insertStatement(db, buildRow(input, userId)));
    }

    if (statements.length === 0) return 0;
    await db.batch(statements);
    return statements.length;
  } catch (e) {
    console.error('[notify] org fan-out failed:', e);
    return 0;
  }
}

async function filterByRole(
  db: D1Database,
  orgId: string,
  roles: string[],
): Promise<Set<string>> {
  const placeholders = roles.map(() => '?').join(', ');
  const { results } = await db.prepare(
    `SELECT id FROM users
     WHERE org_id = ? AND status = 'active' AND role IN (${placeholders})`
  ).bind(orgId, ...roles).all();
  return new Set((results ?? []).map((r) => r.id as string));
}

/**
 * Retention sweep — runs on the cron, not the hot path.
 *
 * Two bounds, because they fail differently: a busy user's inbox is capped by
 * COUNT so it can't grow without limit, and a dormant user's inbox is capped by
 * AGE so stale rows don't linger forever. Read rows are the only ones aged out;
 * an unread notification is still asking for something, so age alone never
 * deletes it — only the per-user cap does.
 */
export async function sweepNotificationRetention(
  db: D1Database,
  opts: { maxPerUser?: number; maxAgeDays?: number } = {},
): Promise<{ deleted: number }> {
  const maxPerUser = opts.maxPerUser ?? 200;
  const maxAgeDays = opts.maxAgeDays ?? 90;

  // Retention housekeeping over ALL tenants, run by the cron with no session.
  // Deletes strictly by age + read state — never by a caller-supplied org or
  // user — so it cannot be steered at a tenant or used to read one.
  // tenant-scope-ok: cron sweep, predicate is age + read_at only
  const aged = await db.prepare(
    `DELETE FROM notifications
     WHERE read_at IS NOT NULL
       AND created_at < datetime('now', ?)`
  ).bind(`-${maxAgeDays} days`).run();

  // Same sweep — trims each recipient's inbox to its newest N rows. The
  // correlated subquery keys on the row's OWN user_id, not on any input, so
  // there is no cross-tenant reach.
  // tenant-scope-ok: cron sweep, self-correlated per-user row cap
  const capped = await db.prepare(
    `DELETE FROM notifications
     WHERE id IN (
       SELECT n.id FROM notifications n
       WHERE (
         SELECT COUNT(*) FROM notifications n2
         WHERE n2.user_id = n.user_id AND n2.created_at > n.created_at
       ) >= ?
     )`
  ).bind(maxPerUser).run();

  return {
    deleted: (aged.meta?.changes ?? 0) + (capped.meta?.changes ?? 0),
  };
}
