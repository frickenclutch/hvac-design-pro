/**
 * User-scoped localStorage utilities.
 *
 * Every localStorage key is prefixed with the authenticated user's ID
 * so that multiple users on the same device have fully isolated state:
 * preferences, projects, calculations, CAD drawings, and workspace config.
 *
 * Pattern: {userId}__{baseKey}
 * Fallback: {baseKey} (only for true guests — no persisted session)
 *
 * Session keys (token, user, org) are intentionally NOT scoped —
 * they represent the active session, not user-owned data.
 *
 * Boot-order safety:
 *   The user ID is seeded synchronously from `hvac_session_user` at module
 *   init, *before* any store creates itself or calls scopedKey(). This
 *   eliminates the boot-window race where stores loaded during early app
 *   startup would otherwise route reads/writes to the unscoped fallback
 *   until useAuthStore registered its live getter — leaving orphan keys
 *   that could push the origin over localStorage quota (a real incident
 *   that broke Settings via QuotaExceededError on a 1.7 MB orphan
 *   `hvac_preferences` containing stamp data URLs).
 */

const SESSION_USER_KEY = 'hvac_session_user';

let _getUser: (() => { id: string } | null) | null = null;

/**
 * Synchronously seed the user getter from the persisted session BEFORE
 * any consumer can call scopedKey(). This runs at module evaluation time,
 * which (per ESM semantics) precedes the body of any module that imports
 * storage.ts — including every store that uses scopedKey on creation.
 */
(function seedAuthFromPersistedSession() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(SESSION_USER_KEY);
    if (!raw) return;
    const user = JSON.parse(raw);
    if (user && typeof user.id === 'string' && user.id) {
      const snapshotId = user.id;
      _getUser = () => ({ id: snapshotId });
    }
  } catch { /* corrupted session_user blob — fall through to guest fallback */ }
})();

function getUserId(): string | null {
  return _getUser?.()?.id ?? null;
}

/**
 * Register the live auth getter from useAuthStore. Replaces the boot-time
 * snapshot with a getter that reflects login/logout transitions in real time.
 */
export function registerAuthGetter(getter: () => { id: string } | null): void {
  _getUser = getter;
}

/**
 * Get a user-scoped localStorage key.
 * Returns "{userId}__{baseKey}" for authenticated users (including any user
 * with a persisted session — see boot-order safety above), or "{baseKey}"
 * as fallback for true guests.
 */
export function scopedKey(baseKey: string): string {
  const uid = getUserId();
  return uid ? `${uid}__${baseKey}` : baseKey;
}

/**
 * Test-only: reset the in-module user getter. Lets vitest exercise the
 * boot-time race deterministically without needing a fresh module graph.
 */
export function __resetAuthGetterForTests(): void {
  _getUser = null;
}

/**
 * Session keys that should NOT be user-scoped.
 * These represent the active session, not user-owned data.
 */
export const SESSION_KEYS = [
  'hvac_session_token',
  'hvac_session_user',
  'hvac_session_org',
] as const;

/**
 * Check if a key is a session key (should not be scoped).
 */
export function isSessionKey(key: string): boolean {
  return (SESSION_KEYS as readonly string[]).includes(key);
}
