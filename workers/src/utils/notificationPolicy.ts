/**
 * Per-tenant notification policy.
 *
 * The tenant admin (or L0) ultimately decides notifications for their org.
 * For each notification kind they pick one of three modes:
 *
 *   - user_choice (default) : each member's own Settings toggle decides
 *                             whether they receive this kind.
 *   - forced_on             : every member receives this kind; they cannot
 *                             opt out (e.g. an org mandating security alerts).
 *   - forced_off            : no member receives this kind, regardless of
 *                             their personal preference.
 *
 * The SERVER is the source of truth for the policy (stored + admin-gated
 * here). The actual delivery decision (policy + member preference → deliver?)
 * is resolved client-side at notify() time, since notifications are currently
 * raised in the browser — see frontend useNotificationStore.resolveDelivery.
 *
 * L0 (`is_platform_admin`) may always edit any org's policy. The tenant admin
 * (role='admin') edits their own org's policy. Everyone else reads it.
 *
 * Storage: merged into organisations.settings JSON under `notificationPolicy`,
 * exactly like accessPolicy. Other settings keys are preserved on write.
 */

export type NotificationKind = 'calc' | 'permit' | 'team' | 'community' | 'security' | 'system';
export type PolicyMode = 'user_choice' | 'forced_on' | 'forced_off';

export const NOTIFICATION_KINDS: NotificationKind[] = [
  'calc', 'permit', 'team', 'community', 'security', 'system',
];

export type NotificationPolicy = Record<NotificationKind, PolicyMode>;

/** Every kind defers to the member by default — the platform ships neutral;
 *  an admin opts INTO forcing anything. */
export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  calc: 'user_choice',
  permit: 'user_choice',
  team: 'user_choice',
  community: 'user_choice',
  security: 'user_choice',
  system: 'user_choice',
};

function isKind(v: unknown): v is NotificationKind {
  return typeof v === 'string' && (NOTIFICATION_KINDS as string[]).includes(v);
}

function isMode(v: unknown): v is PolicyMode {
  return v === 'user_choice' || v === 'forced_on' || v === 'forced_off';
}

function parseSettings(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'string' && settings.trim()) {
    try { return JSON.parse(settings) as Record<string, unknown>; } catch { return {}; }
  }
  if (settings && typeof settings === 'object') return settings as Record<string, unknown>;
  return {};
}

/** Parse the org's settings JSON and merge any stored notificationPolicy over
 *  the defaults. Unknown / malformed values fall back to the default for that
 *  kind — never throw, never leave a kind unset. */
export function resolveNotificationPolicy(settings: unknown): NotificationPolicy {
  const parsed = parseSettings(settings);
  const stored = (parsed.notificationPolicy ?? {}) as Record<string, unknown>;
  const result: NotificationPolicy = { ...DEFAULT_NOTIFICATION_POLICY };
  for (const k of NOTIFICATION_KINDS) {
    if (isMode(stored[k])) result[k] = stored[k] as PolicyMode;
  }
  return result;
}

/** Validate + normalize an incoming policy patch. Returns only the kinds that
 *  were present AND valid; callers merge this over the resolved policy so a
 *  partial PUT only changes what was sent. */
export function sanitizeNotificationPolicyPatch(body: unknown): Partial<NotificationPolicy> {
  const out: Partial<NotificationPolicy> = {};
  if (!body || typeof body !== 'object') return out;
  const b = body as Record<string, unknown>;
  // Accept either a flat { kind: mode } map or { policy: { kind: mode } }.
  const src = (b.policy && typeof b.policy === 'object') ? b.policy as Record<string, unknown> : b;
  for (const [key, val] of Object.entries(src)) {
    if (isKind(key) && isMode(val)) out[key] = val;
  }
  return out;
}

/** Merge a notificationPolicy object back into a settings JSON, preserving
 *  every other settings key. Returns a JSON string ready for the
 *  organisations.settings column. */
export function mergeNotificationPolicyIntoSettings(
  existingSettings: unknown,
  policy: NotificationPolicy,
): string {
  const parsed = parseSettings(existingSettings);
  parsed.notificationPolicy = policy;
  return JSON.stringify(parsed);
}
