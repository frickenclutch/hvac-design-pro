import { create } from 'zustand';
import { scopedKey } from '../utils/storage';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { toast, type ToastType } from './useToastStore';
import { api } from '../lib/api';

/**
 * ── Notification scheme ───────────────────────────────────────────────────────
 *
 * The durable sibling of the toast system. Toasts are transient "it just
 * happened" flashes; notifications are the persistent record you come back to —
 * they survive reloads, badge the header/sidebar bell, and deep-link you to the
 * thing that needs attention.
 *
 * Two levels of control decide what a member actually receives:
 *  1. Org policy (the tenant admin ultimately decides): per kind, forced_on /
 *     forced_off / user_choice. Server-backed (organisations.settings) and
 *     admin-gated — see workers/utils/notificationPolicy + Settings.
 *  2. Member preference: for every `user_choice` kind, the member's own
 *     Settings toggle. Per-user, local.
 * The two combine in `resolveDelivery` — forced modes win, otherwise the
 * member decides. A kind that resolves to "off" is never even recorded.
 *
 * The `enabled` master switch (the bell quick-toggle) is a separate, lighter
 * control: pure DND. It never drops anything — muting only silences the toast
 * ping and the pending swirl; the item is still recorded and badged.
 *
 * Design mirrors the platform's idioms: Zustand hydrated from localStorage on
 * creation, per-USER scoped persistence (scopedKey), a `notify.*` convenience
 * API mirroring `toast.*`, and an org-policy cache refreshed from the server on
 * auth (mirroring useAccessPolicyStore).
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
  /** In-app route (react-router path) to act on this notification. */
  href?: string;
  read: boolean;
  createdAt: number; // epoch ms
}

/** Fields a caller supplies when raising a notification. */
export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  severity?: NotificationSeverity;
  /** Also flash a transient toast for immediacy (default true). Ignored while
   *  alerts are muted. */
  toast?: boolean;
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
 * Pure + exported so it can be unit-tested in isolation.
 */
export function resolveDelivery(mode: PolicyMode, userPref: boolean): boolean {
  if (mode === 'forced_off') return false;
  if (mode === 'forced_on') return true;
  return userPref;
}

interface NotificationState {
  notifications: AppNotification[];
  /** Master alerts switch — the header/sidebar quick-enable (DND). true = on. */
  enabled: boolean;
  /** Member's per-kind preferences (consulted only for user_choice kinds). */
  userPrefs: Record<NotificationKind, boolean>;
  /** Org-wide policy from the server (admin-set). Defaults to all user_choice. */
  orgPolicy: NotificationPolicy;
  /** True once the org policy has been fetched at least once this session. */
  orgPolicyLoaded: boolean;

  push: (input: NotifyInput) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  clearRead: () => void;
  setEnabled: (value: boolean) => void;
  toggleEnabled: () => void;
  setUserPref: (kind: NotificationKind, on: boolean) => void;
  /** Fetch (or refetch) the org policy for the current session. Coalesces. */
  refreshOrgPolicy: () => Promise<void>;
}

const LIST_KEY = 'hvac_notifications';
const ENABLED_KEY = 'hvac_notifications_enabled';
const PREFS_KEY = 'hvac_notifications_prefs';
const POLICY_CACHE_KEY = 'hvac_notifications_orgpolicy';
const WELCOMED_KEY = 'hvac_notifications_welcomed';

/** Hard cap on retained notifications — bounds localStorage footprint. */
const MAX_NOTIFICATIONS = 50;

const severityToToast: Record<NotificationSeverity, ToastType> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  critical: 'error',
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadList(): AppNotification[] {
  try {
    const raw = localStorage.getItem(scopedKey(LIST_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is AppNotification =>
        n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.createdAt === 'number')
      .slice(0, MAX_NOTIFICATIONS);
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
  try { localStorage.setItem(scopedKey(LIST_KEY), JSON.stringify(list)); } catch { /* quota */ }
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

/**
 * One-time-per-user welcome so the panel isn't a blank void on first open and
 * the pending bell state is demonstrated. A genuine system message describing
 * the feature — not fabricated activity. Seeded directly (bypasses delivery
 * resolution) since it runs at init before the org policy has loaded.
 */
function maybeSeedWelcome(existing: AppNotification[]): AppNotification[] {
  try {
    if (localStorage.getItem(scopedKey(WELCOMED_KEY)) === '1') return existing;
    if (scopedKey(WELCOMED_KEY) === WELCOMED_KEY) return existing; // guest — skip
    localStorage.setItem(scopedKey(WELCOMED_KEY), '1');
    const welcome: AppNotification = {
      id: makeId(),
      kind: 'system',
      severity: 'info',
      title: 'Notifications are on',
      body: "You'll be alerted here when access changes, and as calculation, permit, and team activity lands. Choose which kinds you get in Settings → Notifications; your organization may require some.",
      read: false,
      createdAt: Date.now(),
    };
    return [welcome, ...existing].slice(0, MAX_NOTIFICATIONS);
  } catch {
    return existing;
  }
}

let policyInFlight: Promise<void> | null = null;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: maybeSeedWelcome(loadList()),
  enabled: loadEnabled(),
  userPrefs: loadUserPrefs(),
  orgPolicy: loadPolicyCache(),
  orgPolicyLoaded: false,

  push: (input) => {
    // Delivery gate: org policy + member preference decide whether this kind is
    // recorded at all. Forced-off or opted-out kinds are dropped silently.
    const mode = get().orgPolicy[input.kind] ?? 'user_choice';
    const pref = get().userPrefs[input.kind] ?? true;
    if (!resolveDelivery(mode, pref)) return;

    const notification: AppNotification = {
      id: makeId(),
      kind: input.kind,
      severity: input.severity ?? 'info',
      title: input.title,
      body: input.body,
      href: input.href,
      read: false,
      createdAt: Date.now(),
    };

    set((s) => {
      const next = [notification, ...s.notifications].slice(0, MAX_NOTIFICATIONS);
      persistList(next);
      return { notifications: next };
    });

    // Muted (DND) → record silently. Otherwise flash a transient toast unless
    // the caller opted out, so the user gets both the ping and the durable row.
    if (get().enabled && input.toast !== false) {
      toast[severityToToast[notification.severity]](notification.title);
    }
  },

  markRead: (id) =>
    set((s) => {
      const next = s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
      persistList(next);
      return { notifications: next };
    }),

  markAllRead: () =>
    set((s) => {
      const next = s.notifications.map((n) => (n.read ? n : { ...n, read: true }));
      persistList(next);
      return { notifications: next };
    }),

  dismiss: (id) =>
    set((s) => {
      const next = s.notifications.filter((n) => n.id !== id);
      persistList(next);
      return { notifications: next };
    }),

  clearAll: () =>
    set(() => {
      persistList([]);
      return { notifications: [] };
    }),

  clearRead: () =>
    set((s) => {
      const next = s.notifications.filter((n) => !n.read);
      persistList(next);
      return { notifications: next };
    }),

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

  setUserPref: (kind, on) =>
    set((s) => {
      const userPrefs = { ...s.userPrefs, [kind]: on };
      persistUserPrefs(userPrefs);
      return { userPrefs };
    }),

  refreshOrgPolicy: async () => {
    if (policyInFlight) return policyInFlight;
    // Only fetch for a real signed-in user; guests have no org.
    if (!useAuthStore.getState().user) return;
    policyInFlight = (async () => {
      try {
        const res = await api.getNotificationPolicy();
        const policy = { ...DEFAULT_POLICY };
        for (const k of ALL_KINDS) {
          const v = res.policy?.[k];
          if (v === 'user_choice' || v === 'forced_on' || v === 'forced_off') policy[k] = v;
        }
        persistPolicyCache(policy);
        set({ orgPolicy: policy, orgPolicyLoaded: true });
      } catch {
        // Keep last-good cache; the server still governs — a failed fetch just
        // means the client resolves against the previously cached policy.
        set({ orgPolicyLoaded: true });
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
// Notifications + preferences are per-user; the org policy is per-org. When the
// signed-in user changes without a full reload (logout→login, impersonation,
// account transfer), swap every per-user slice to the new scope and refetch the
// new org's policy — so nothing leaks across sessions.
let lastUserId: string | null = useAuthStore.getState().user?.id ?? null;
useAuthStore.subscribe((state) => {
  const uid = state.user?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  policyInFlight = null;
  if (!uid) {
    useNotificationStore.setState({
      notifications: [], enabled: true, userPrefs: defaultUserPrefs(),
      orgPolicy: { ...DEFAULT_POLICY }, orgPolicyLoaded: false,
    });
    return;
  }
  useNotificationStore.setState({
    notifications: maybeSeedWelcome(loadList()),
    enabled: loadEnabled(),
    userPrefs: loadUserPrefs(),
    orgPolicy: loadPolicyCache(),
    orgPolicyLoaded: false,
  });
  void useNotificationStore.getState().refreshOrgPolicy();
});

// ── Standalone convenience API (callable from non-React code) ─────────────────
type NotifyOpts = Omit<NotifyInput, 'kind' | 'title'>;

function raise(kind: NotificationKind, defaultSeverity: NotificationSeverity) {
  return (title: string, opts: NotifyOpts = {}) =>
    useNotificationStore.getState().push({ kind, title, severity: defaultSeverity, ...opts });
}

export const notify = {
  calc: raise('calc', 'success'),
  permit: raise('permit', 'info'),
  team: raise('team', 'info'),
  community: raise('community', 'info'),
  security: raise('security', 'warning'),
  system: raise('system', 'info'),
  /** Escape hatch for a fully-specified notification. */
  push: (input: NotifyInput) => useNotificationStore.getState().push(input),
};

// Expose on window for manual testing in dev console (parallels window.__toast).
if (typeof window !== 'undefined') {
  (window as unknown as { __notify?: typeof notify }).__notify = notify;
}
