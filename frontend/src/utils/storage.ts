/**
 * User-scoped localStorage utilities.
 *
 * Every localStorage key is prefixed with the authenticated user's ID
 * so that multiple users on the same device have fully isolated state:
 * preferences, projects, calculations, CAD drawings, and workspace config.
 *
 * Pattern: {userId}__{baseKey}
 * Fallback: {baseKey} (if no user is authenticated — guest/loading)
 *
 * Session keys (token, user, org) are intentionally NOT scoped —
 * they represent the active session, not user-owned data.
 */

// Lazy import to avoid circular dependency with auth store
let _getUser: (() => { id: string } | null) | null = null;

function getUserId(): string | null {
  if (!_getUser) {
    try {
      // Dynamic require to break circular dependency
      const mod = (window as any).__authStoreGetter;
      if (mod) _getUser = mod;
    } catch { /* not ready yet */ }
  }
  return _getUser?.()?.id ?? null;
}

/**
 * Register the auth store getter. Called once from useAuthStore on module load.
 */
export function registerAuthGetter(getter: () => { id: string } | null): void {
  _getUser = getter;
  (window as any).__authStoreGetter = getter;
}

/**
 * Get a user-scoped localStorage key.
 * Returns "{userId}__{baseKey}" for authenticated users,
 * or "{baseKey}" as fallback for guests/loading.
 */
export function scopedKey(baseKey: string): string {
  const uid = getUserId();
  return uid ? `${uid}__${baseKey}` : baseKey;
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
  return SESSION_KEYS.includes(key as any);
}
