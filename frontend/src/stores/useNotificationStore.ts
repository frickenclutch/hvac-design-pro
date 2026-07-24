import { create } from 'zustand';
import { scopedKey } from '../utils/storage';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { api, type ServerNotification } from '../lib/api';

/**
 * ── Notification scheme ───────────────────────────────────────────────────────
 *
 * The durable sibling of the toast system. Toasts are transient "it just
 * happened" flashes; notifications are the persistent record you come back to —
 * they survive reloads, badge the header/sidebar bell, and deep-link you to the
 * thing that needs attention.
 *
 * ── Where notifications come from (changed 2026-07-23) ───────────────────────
 * The SERVER raises them. Workers handlers call `notifyUser` / `notifyOrg`
 * (workers/src/utils/notifications.ts) at the same points they call `setAudit`,
 * and rows land in the `notifications` table (migration 0021).
 *
 * They used to be raised in the browser, which quietly capped what the feature
 * could ever be: a notification could only describe something that happened in
 * front of the very person being notified. The events actually worth alerting
 * on are the ones you AREN'T watching — an authority approving your permit, an
 * admin changing your role, a teammate accepting an invite. None of those could
 * reach you, on any transport. That is why there is deliberately NO client-side
 * `notify.*` API any more: a call to one would look like it worked, then vanish
 * on the next hydrate. If something should notify, emit it from the Worker.
 *
 * ── This store's job ─────────────────────────────────────────────────────────
 * It is a CACHE over the server's inbox, not the source of truth.
 *  - `hydrate()` pulls the authoritative list; localStorage holds the last-good
 *    copy so the bell still renders offline and on a cold boot before the fetch
 *    lands.
 *  - Mutations apply locally first, then sync. A failed sync never rolls the UI
 *    back or clears state (offline-first PWA, CLAUDE.md §4.5) — the next
 *    hydrate reconciles against the server.
 *
 * ── The two controls ─────────────────────────────────────────────────────────
 *  1. Which kinds you RECEIVE — org policy (forced_on/forced_off/user_choice,
 *     admin-set) combined with the member's per-kind preference. Both now live
 *     server-side and are resolved at emission time by `resolveDelivery`, so a
 *     suppressed kind is never written at all. `userPrefs` here is a mirror of
 *     the server's copy, kept so Settings renders instantly.
 *  2. Whether alerts INTERRUPT you — the `enabled` master switch (DND). This
 *     one stays deliberately device-local: "don't ping me on this machine right
 *     now" is a property of where you're sitting, not of your account. It never
 *     drops anything; it only silences the bell's pending animation.
 */

export type NotificationKind =
  | 'calc'       // calculation finished / drift / engine event
  | 'permit'     // permit submission status change
  | 'team'       // team / org membership
  | 'community'  // forum reply / mention
  | 'security'   // access, role, session, auth events
  | 'system';    // platform / housekeeping

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

/** Per-kind org policy mode. Kept in sync with workers/utils/notificationPolicy. */
export type PolicyMode = 'user_choice' | 'forced_on' | 'forced_off';
export type NotificationPolicy = Record<NotificationKind, PolicyMode>;

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  /** In-app route (react-router path) to act on this notification. The server
   *  rejects anything that isn't a relative path, so this can never become an
   *  off-site redirect. */
  href?: string;
  read: boolean;
  createdAt: number; // epoch ms
}

/** Ordered kind metadata — drives the Settings per-kind rows (label + blurb)
 *  and keeps the user-facing copy in one place. */
export const NOTIFICATION_KIND_META: { kind: NotificationKind; label: string; description: string }[] = [
  { kind: 'calc', label: 'Calculations', description: 'Load calculations finishing, engine drift, and shadow-run results.' },
  { kind: 'permit', label: 'Permits', description: 'Submission status changes and authority decisions.' },
  { kind: 'team', label: 'Team', description: 'Invitations, membership, and role changes in your organization.' },
  { kind: 'community', label: 'Community', description: 'Replies and mentions on shared community projects.' },
  { kind: 'security', label: 'Security & access', description: 'Access-level changes, sessions, and account security.' },
  { kind: 'system', label: 'System', description: 'Platform notices and housekeeping.' },
];

const ALL_KINDS: NotificationKind[] = NOTIFICATION_KIND_META.map((m) => m.kind);
const KIND_SET = new Set<string>(ALL_KINDS);
const SEVERITIES = new Set<string>(['info', 'success', 'warning', 'critical']);

const DEFAULT_POLICY: NotificationPolicy = {
  calc: 'user_choice', permit: 'user_choice', team: 'user_choice',
  community: 'user_choice', security: 'user_choice', system: 'user_choice',
};

function defaultUserPrefs(): Record<NotificationKind, boolean> {
  // Opt-in to everything by default; the member narrows from there.
  return { calc: true, permit: true, team: true, community: true, security: true, system: true };
}

/**
 * The single source of truth for "does this member receive this kind?".
 * Forced modes override the member; otherwise the member's toggle decides.
 * Pure + exported so it can be unit-tested in isolation. Mirrored verbatim in
 * workers/src/utils/notifications.ts, where it is now actually enforced — this
 * copy drives the Settings lock states.
 */
export function resolveDelivery(mode: PolicyMode, userPref: boolean): boolean {
  if (mode === 'forced_off') return false;
  if (mode === 'forced_on') return true;
  return userPref;
}

interface NotificationState {
  notifications: AppNotification[];
  /** Master alerts switch — the header/sidebar quick-enable (DND). Device-local. */
  enabled: boolean;
  /** Member's per-kind preferences, mirrored from the server. */
  userPrefs: Record<NotificationKind, boolean>;
  /** Org-wide policy from the server (admin-set). Defaults to all user_choice. */
  orgPolicy: NotificationPolicy;
  /** True once the server inbox has been fetched at least once this session. */
  hydrated: boolean;

  /** Pull the authoritative inbox + preferences. Safe to call often; coalesces. */
  hydrate: () => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  setEnabled: (value: boolean) => void;
  toggleEnabled: () => void;
  setUserPref: (kind: NotificationKind, on: boolean) => void;
  /** Refresh the org policy + member prefs (one request). */
  refreshOrgPolicy: () => Promise<void>;
}

const LIST_KEY = 'hvac_notifications';
const ENABLED_KEY = 'hvac_notifications_enabled';
const PREFS_KEY = 'hvac_notifications_prefs';
const POLICY_CACHE_KEY = 'hvac_notifications_orgpolicy';

/** Bounds the localStorage cache. The server enforces its own retention. */
const MAX_CACHED = 50;

// ── Cache (localStorage) ─────────────────────────────────────────────────────

/** Narrow an untrusted cached/served row into an AppNotification, or null.
 *  Applied to BOTH the localStorage cache and the API response — a cached blob
 *  is as untrusted as a network one, and a bad row must never crash the bell.
 *  Exported for unit test; not part of the store's public surface. */
export function coerceNotification(raw: unknown): AppNotification | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== 'string' || typeof n.title !== 'string') return null;
  if (typeof n.kind !== 'string' || !KIND_SET.has(n.kind)) return null;
  if (typeof n.createdAt !== 'number' || !Number.isFinite(n.createdAt)) return null;
  const severity = typeof n.severity === 'string' && SEVERITIES.has(n.severity)
    ? n.severity as NotificationSeverity
    : 'info';
  // Relative paths only — belt-and-braces against a poisoned cache, since the
  // server already rejects absolute hrefs on the way in.
  const href = typeof n.href === 'string' && n.href.startsWith('/') && !n.href.startsWith('//')
    ? n.href
    : undefined;
  return {
    id: n.id,
    kind: n.kind as NotificationKind,
    severity,
    title: n.title,
    body: typeof n.body === 'string' ? n.body : undefined,
    href,
    read: n.read === true,
    createdAt: n.createdAt,
  };
}

function loadList(): AppNotification[] {
  try {
    const raw = localStorage.getItem(scopedKey(LIST_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(coerceNotification)
      .filter((n): n is AppNotification => n !== null)
      .slice(0, MAX_CACHED);
  } catch {
    return [];
  }
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(scopedKey(ENABLED_KEY)) !== '0';
  } catch {
    return true;
  }
}

function loadUserPrefs(): Record<NotificationKind, boolean> {
  const prefs = defaultUserPrefs();
  try {
    const raw = localStorage.getItem(scopedKey(PREFS_KEY));
    if (!raw) return prefs;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const k of ALL_KINDS) {
      if (typeof parsed[k] === 'boolean') prefs[k] = parsed[k] as boolean;
    }
  } catch { /* keep defaults */ }
  return prefs;
}

function loadPolicyCache(): NotificationPolicy {
  const policy = { ...DEFAULT_POLICY };
  try {
    const raw = localStorage.getItem(scopedKey(POLICY_CACHE_KEY));
    if (!raw) return policy;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const k of ALL_KINDS) {
      const v = parsed[k];
      if (v === 'user_choice' || v === 'forced_on' || v === 'forced_off') policy[k] = v;
    }
  } catch { /* keep defaults */ }
  return policy;
}

function persistList(list: AppNotification[]): void {
  try {
    localStorage.setItem(scopedKey(LIST_KEY), JSON.stringify(list.slice(0, MAX_CACHED)));
  } catch { /* quota */ }
}
function persistEnabled(enabled: boolean): void {
  try { localStorage.setItem(scopedKey(ENABLED_KEY), enabled ? '1' : '0'); } catch { /* best-effort */ }
}
function persistUserPrefs(prefs: Record<NotificationKind, boolean>): void {
  try { localStorage.setItem(scopedKey(PREFS_KEY), JSON.stringify(prefs)); } catch { /* best-effort */ }
}
function persistPolicyCache(policy: NotificationPolicy): void {
  try { localStorage.setItem(scopedKey(POLICY_CACHE_KEY), JSON.stringify(policy)); } catch { /* best-effort */ }
}

/** Signed in? Guests have no inbox and no org — skip every network call. */
function isSignedIn(): boolean {
  return !!useAuthStore.getState().user;
}

let hydrateInFlight: Promise<void> | null = null;
let policyInFlight: Promise<void> | null = null;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: loadList(),
  enabled: loadEnabled(),
  userPrefs: loadUserPrefs(),
  orgPolicy: loadPolicyCache(),
  hydrated: false,

  hydrate: async () => {
    if (hydrateInFlight) return hydrateInFlight;
    if (!isSignedIn()) return;
    hydrateInFlight = (async () => {
      try {
        const res = await api.getNotifications();
        const list = (res.notifications ?? [])
          .map((n: ServerNotification) => coerceNotification(n))
          .filter((n): n is AppNotification => n !== null);
        persistList(list);
        set({ notifications: list, hydrated: true });
      } catch {
        // Offline / transient failure: keep the cached list exactly as it is.
        // Clearing here would make the bell lie about having nothing pending.
        set({ hydrated: true });
      } finally {
        hydrateInFlight = null;
      }
    })();
    return hydrateInFlight;
  },

  // ── Mutations: apply locally, then sync. The local write is what the user
  //    sees, so it must not wait on the network; the server call is the durable
  //    half and a failure is reconciled by the next hydrate.
  markRead: (id) => {
    const target = get().notifications.find((n) => n.id === id);
    if (!target || target.read) return;
    set((s) => {
      const next = s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
      persistList(next);
      return { notifications: next };
    });
    if (isSignedIn()) {
      void api.markNotificationsRead({ ids: [id] }).catch(() => { /* next hydrate reconciles */ });
    }
  },

  markAllRead: () => {
    if (!get().notifications.some((n) => !n.read)) return;
    set((s) => {
      const next = s.notifications.map((n) => (n.read ? n : { ...n, read: true }));
      persistList(next);
      return { notifications: next };
    });
    if (isSignedIn()) {
      void api.markNotificationsRead({ all: true }).catch(() => { /* next hydrate reconciles */ });
    }
  },

  dismiss: (id) => {
    set((s) => {
      const next = s.notifications.filter((n) => n.id !== id);
      persistList(next);
      return { notifications: next };
    });
    if (isSignedIn()) {
      void api.dismissNotification(id).catch(() => { /* next hydrate reconciles */ });
    }
  },

  clearAll: () => {
    set(() => {
      persistList([]);
      return { notifications: [] };
    });
    if (isSignedIn()) {
      void api.clearNotifications().catch(() => { /* next hydrate reconciles */ });
    }
  },

  setEnabled: (value) =>
    set(() => {
      persistEnabled(value);
      return { enabled: value };
    }),

  toggleEnabled: () =>
    set((s) => {
      const enabled = !s.enabled;
      persistEnabled(enabled);
      return { enabled };
    }),

  setUserPref: (kind, on) => {
    set((s) => {
      const userPrefs = { ...s.userPrefs, [kind]: on };
      persistUserPrefs(userPrefs);
      return { userPrefs };
    });
    // The server is the enforcement point now — a preference that only lived
    // here would be ignored at emission time.
    if (isSignedIn()) {
      void api.setNotificationPreferences({ [kind]: on }).catch(() => { /* retried on next refresh */ });
    }
  },

  refreshOrgPolicy: async () => {
    if (policyInFlight) return policyInFlight;
    if (!isSignedIn()) return;
    policyInFlight = (async () => {
      try {
        // One request returns both halves of the delivery decision.
        const res = await api.getNotificationPreferences();
        const policy = { ...DEFAULT_POLICY };
        for (const k of ALL_KINDS) {
          const v = res.policy?.[k];
          if (v === 'user_choice' || v === 'forced_on' || v === 'forced_off') policy[k] = v;
        }
        const prefs = defaultUserPrefs();
        for (const k of ALL_KINDS) {
          if (typeof res.prefs?.[k] === 'boolean') prefs[k] = res.prefs[k];
        }
        persistPolicyCache(policy);
        persistUserPrefs(prefs);
        set({ orgPolicy: policy, userPrefs: prefs });
      } catch {
        // Keep last-good cache; the server still governs — a failed fetch just
        // means Settings renders against the previously cached policy.
      } finally {
        policyInFlight = null;
      }
    })();
    return policyInFlight;
  },
}));

/** Unread count selector — use with useNotificationStore(selectUnreadCount). */
export const selectUnreadCount = (s: NotificationState): number =>
  s.notifications.reduce((acc, n) => (n.read ? acc : acc + 1), 0);

// ── Re-hydrate on user change ────────────────────────────────────────────────
// The inbox and preferences are per-user. When the signed-in user changes
// without a full reload (logout→login, impersonation, account transfer), swap
// every per-user slice to the new scope and refetch — so one member's inbox is
// never visible to the next.
let lastUserId: string | null = useAuthStore.getState().user?.id ?? null;
useAuthStore.subscribe((state) => {
  const uid = state.user?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  hydrateInFlight = null;
  policyInFlight = null;
  if (!uid) {
    useNotificationStore.setState({
      notifications: [], enabled: true, userPrefs: defaultUserPrefs(),
      orgPolicy: { ...DEFAULT_POLICY }, hydrated: false,
    });
    return;
  }
  useNotificationStore.setState({
    notifications: loadList(),
    enabled: loadEnabled(),
    userPrefs: loadUserPrefs(),
    orgPolicy: loadPolicyCache(),
    hydrated: false,
  });
  void useNotificationStore.getState().hydrate();
  void useNotificationStore.getState().refreshOrgPolicy();
});
