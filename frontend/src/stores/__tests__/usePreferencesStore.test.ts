// @vitest-environment jsdom
/**
 * usePreferencesStore — orphan migration coverage.
 *
 * The architectural fix in storage.ts seeds the user getter synchronously
 * from `hvac_session_user`, which keeps future writes routed to the scoped
 * key. But existing user machines may already carry an unscoped
 * `hvac_preferences` orphan (real-world case: 1.7 MB of stamp data URLs
 * uploaded during the boot-window race, pushing the origin over quota
 * and silently breaking Settings via QuotaExceededError).
 *
 * These tests cover the one-shot migration in load(): merge what we can
 * rescue (stamp images), then remove the orphan, gated by a per-user flag.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// jsdom setMatchMedia + minimal document shim so applyTheme() doesn't crash
// when the store hydrates during import.
beforeEach(() => {
  localStorage.clear();
  // Seat a session so scopedKey returns scoped from tick 0.
  localStorage.setItem(
    'hvac_session_user',
    JSON.stringify({ id: 'user-xyz', email: 'a@b.com', role: 'admin' }),
  );
});

afterEach(() => {
  localStorage.clear();
});

async function loadStoreFresh() {
  vi.resetModules();
  return await import('../usePreferencesStore');
}

const SCOPED = 'user-xyz__hvac_preferences';
const ORPHAN = 'hvac_preferences';
const FLAG = 'user-xyz__hvac_preferences_migrated_v2';

describe('usePreferencesStore orphan migration', () => {
  it('promotes orphan to scoped key when scoped is empty', async () => {
    const orphanPrefs = {
      theme: 'dark',
      firmStampDataUrl: 'data:image/png;base64,AAAA',
      notaryStampDataUrl: 'data:image/png;base64,BBBB',
    };
    localStorage.setItem(ORPHAN, JSON.stringify(orphanPrefs));

    await loadStoreFresh();

    const promoted = localStorage.getItem(SCOPED);
    expect(promoted).not.toBeNull();
    const parsed = JSON.parse(promoted!);
    expect(parsed.firmStampDataUrl).toBe('data:image/png;base64,AAAA');
    expect(parsed.notaryStampDataUrl).toBe('data:image/png;base64,BBBB');

    expect(localStorage.getItem(ORPHAN)).toBeNull();
    expect(localStorage.getItem(FLAG)).toBe('1');
  });

  it('merges stamp data URLs from orphan into scoped when scoped lacks them', async () => {
    const orphan = {
      theme: 'midnight',
      firmStampDataUrl: 'data:image/png;base64,FIRM',
      notaryStampDataUrl: 'data:image/png;base64,NOTARY',
    };
    const scoped = {
      theme: 'light',
      firmStampDataUrl: '',
      notaryStampDataUrl: '',
      sidebarCollapsed: true,
    };
    localStorage.setItem(ORPHAN, JSON.stringify(orphan));
    localStorage.setItem(SCOPED, JSON.stringify(scoped));

    await loadStoreFresh();

    const merged = JSON.parse(localStorage.getItem(SCOPED)!);
    // Stamps rescued
    expect(merged.firmStampDataUrl).toBe('data:image/png;base64,FIRM');
    expect(merged.notaryStampDataUrl).toBe('data:image/png;base64,NOTARY');
    // Scoped values preserved (theme + non-stamp fields)
    expect(merged.theme).toBe('light');
    expect(merged.sidebarCollapsed).toBe(true);

    expect(localStorage.getItem(ORPHAN)).toBeNull();
    expect(localStorage.getItem(FLAG)).toBe('1');
  });

  it('does NOT overwrite scoped stamps when scoped already has them', async () => {
    const orphan = {
      firmStampDataUrl: 'data:image/png;base64,OLD',
      notaryStampDataUrl: 'data:image/png;base64,OLD',
    };
    const scoped = {
      theme: 'dark',
      firmStampDataUrl: 'data:image/png;base64,NEW',
      notaryStampDataUrl: 'data:image/png;base64,NEW',
    };
    localStorage.setItem(ORPHAN, JSON.stringify(orphan));
    localStorage.setItem(SCOPED, JSON.stringify(scoped));

    await loadStoreFresh();

    const merged = JSON.parse(localStorage.getItem(SCOPED)!);
    expect(merged.firmStampDataUrl).toBe('data:image/png;base64,NEW');
    expect(merged.notaryStampDataUrl).toBe('data:image/png;base64,NEW');

    expect(localStorage.getItem(ORPHAN)).toBeNull();
  });

  it('is idempotent — second hydration with reseeded orphan is a no-op (flag gate)', async () => {
    localStorage.setItem(ORPHAN, JSON.stringify({ firmStampDataUrl: 'data:image/png;base64,A' }));
    await loadStoreFresh();
    expect(localStorage.getItem(ORPHAN)).toBeNull();
    expect(localStorage.getItem(FLAG)).toBe('1');

    // Simulate something re-creating the orphan (shouldn't happen post-fix,
    // but if it does, the per-user flag prevents a re-merge surprise).
    localStorage.setItem(ORPHAN, JSON.stringify({ firmStampDataUrl: 'data:image/png;base64,B' }));
    await loadStoreFresh();
    // Flag short-circuited migration — orphan untouched.
    expect(localStorage.getItem(ORPHAN)).not.toBeNull();
  });

  it('sets the flag when there is no orphan to migrate (avoids re-probing)', async () => {
    expect(localStorage.getItem(ORPHAN)).toBeNull();
    await loadStoreFresh();
    expect(localStorage.getItem(FLAG)).toBe('1');
  });

  it('skips migration entirely for guests (no scoped namespace to anchor to)', async () => {
    localStorage.removeItem('hvac_session_user');
    localStorage.setItem(ORPHAN, JSON.stringify({ theme: 'dark' }));

    await loadStoreFresh();

    // Guest: scopedKey == ORPHAN, so the orphan IS the live key.
    // Migration must not delete it.
    expect(localStorage.getItem(ORPHAN)).not.toBeNull();
  });

  it('handles corrupt orphan JSON without throwing — drops it', async () => {
    localStorage.setItem(ORPHAN, '{not valid json');
    localStorage.setItem(SCOPED, JSON.stringify({ theme: 'dark' }));

    await loadStoreFresh();

    expect(localStorage.getItem(ORPHAN)).toBeNull();
    // Scoped untouched
    const scoped = JSON.parse(localStorage.getItem(SCOPED)!);
    expect(scoped.theme).toBe('dark');
  });
});
