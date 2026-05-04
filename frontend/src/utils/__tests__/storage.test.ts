// @vitest-environment jsdom
/**
 * Boot-time key-scoping race coverage.
 *
 * The architectural fix (Option C in the storage.ts comment) is to
 * synchronously seed the user getter from `hvac_session_user` at module
 * init, before any store touches scopedKey(). These tests pin that
 * behaviour so a future refactor can't silently regress to the
 * "scopedKey() falls back to unscoped during boot" footgun that pushed
 * a real user over localStorage quota.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Helpers — re-import storage.ts after each localStorage swap so the
// module-init seed runs against the test's fixture.
async function loadStorageFresh() {
  vi.resetModules();
  return await import('../storage');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('storage.scopedKey — boot-time seed', () => {
  it('returns unscoped fallback when no persisted session exists (true guest)', async () => {
    const { scopedKey } = await loadStorageFresh();
    expect(scopedKey('hvac_preferences')).toBe('hvac_preferences');
  });

  it('returns scoped key on first call after boot when session_user is persisted', async () => {
    // Simulate: useAuthStore.persistSession ran in a prior load, so
    // hvac_session_user is in localStorage when storage.ts evaluates.
    localStorage.setItem(
      'hvac_session_user',
      JSON.stringify({ id: 'user-abc', email: 'a@b.com', role: 'admin' }),
    );
    const { scopedKey } = await loadStorageFresh();
    expect(scopedKey('hvac_preferences')).toBe('user-abc__hvac_preferences');
  });

  it('falls back to unscoped if persisted session is corrupt JSON', async () => {
    localStorage.setItem('hvac_session_user', 'not-json{');
    const { scopedKey } = await loadStorageFresh();
    expect(scopedKey('hvac_preferences')).toBe('hvac_preferences');
  });

  it('falls back to unscoped if persisted user has no id', async () => {
    localStorage.setItem('hvac_session_user', JSON.stringify({ email: 'a@b.com' }));
    const { scopedKey } = await loadStorageFresh();
    expect(scopedKey('hvac_preferences')).toBe('hvac_preferences');
  });

  it('registerAuthGetter overrides the boot-time snapshot (login transition)', async () => {
    const { scopedKey, registerAuthGetter } = await loadStorageFresh();
    expect(scopedKey('hvac_preferences')).toBe('hvac_preferences');
    registerAuthGetter(() => ({ id: 'fresh-login-id' }));
    expect(scopedKey('hvac_preferences')).toBe('fresh-login-id__hvac_preferences');
  });

  it('registerAuthGetter returning null reverts to guest fallback (logout transition)', async () => {
    localStorage.setItem(
      'hvac_session_user',
      JSON.stringify({ id: 'user-abc' }),
    );
    const { scopedKey, registerAuthGetter } = await loadStorageFresh();
    expect(scopedKey('hvac_preferences')).toBe('user-abc__hvac_preferences');
    registerAuthGetter(() => null);
    expect(scopedKey('hvac_preferences')).toBe('hvac_preferences');
  });
});
