// @vitest-environment jsdom
/**
 * The notification store, after emission moved to the server (2026-07-23).
 *
 * What is covered here is what still lives on the client:
 *   - `resolveDelivery` — the governance rule. It is ENFORCED in the Worker
 *     now (see workers/test/notifications.test.ts, which proves the gate against
 *     a real D1); this copy drives the Settings lock states, so both sides are
 *     tested against the same truth table.
 *   - `coerceNotification` — the trust boundary. Everything entering the store
 *     comes from either the network or a localStorage blob, and neither is
 *     trustworthy. A malformed row must be dropped, not rendered, not thrown on.
 *   - Optimistic mutations — the user sees their click immediately; the server
 *     sync is the durable half and its failure must never roll the UI back.
 *
 * What is deliberately NOT covered here any more: client-side delivery gating.
 * There is no `push()` to gate — a notification the browser invents is a
 * notification no other device will ever see, which is exactly the design flaw
 * the server-side emitter replaced.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveDelivery,
  coerceNotification,
  useNotificationStore,
  type AppNotification,
} from '../useNotificationStore';

describe('resolveDelivery', () => {
  it('forced_off never delivers, regardless of member preference', () => {
    expect(resolveDelivery('forced_off', true)).toBe(false);
    expect(resolveDelivery('forced_off', false)).toBe(false);
  });
  it('forced_on always delivers, regardless of member preference', () => {
    expect(resolveDelivery('forced_on', true)).toBe(true);
    expect(resolveDelivery('forced_on', false)).toBe(true);
  });
  it('user_choice defers to the member preference', () => {
    expect(resolveDelivery('user_choice', true)).toBe(true);
    expect(resolveDelivery('user_choice', false)).toBe(false);
  });
});

describe('coerceNotification — the trust boundary', () => {
  const valid = {
    id: 'n1', kind: 'permit', severity: 'success',
    title: 'Permit approved', body: 'Nice', href: '/permits',
    read: false, createdAt: 1_700_000_000_000,
  };

  it('accepts a well-formed row unchanged', () => {
    expect(coerceNotification(valid)).toEqual({
      id: 'n1', kind: 'permit', severity: 'success',
      title: 'Permit approved', body: 'Nice', href: '/permits',
      read: false, createdAt: 1_700_000_000_000,
    });
  });

  it('rejects rows missing the fields the UI indexes on', () => {
    expect(coerceNotification(null)).toBeNull();
    expect(coerceNotification('a string')).toBeNull();
    expect(coerceNotification({ ...valid, id: undefined })).toBeNull();
    expect(coerceNotification({ ...valid, title: 42 })).toBeNull();
    expect(coerceNotification({ ...valid, createdAt: 'yesterday' })).toBeNull();
    expect(coerceNotification({ ...valid, createdAt: NaN })).toBeNull();
  });

  it('rejects an unknown kind rather than rendering an unstyled row', () => {
    // kindMeta[] is indexed by kind in NotificationCenter — an unknown kind
    // would dereference undefined and blank the whole panel.
    expect(coerceNotification({ ...valid, kind: 'billing' })).toBeNull();
  });

  it('falls back to info for an unknown severity', () => {
    expect(coerceNotification({ ...valid, severity: 'catastrophic' })?.severity).toBe('info');
  });

  it('strips a non-relative href — a notification must never redirect off-site', () => {
    expect(coerceNotification({ ...valid, href: 'https://evil.example' })?.href).toBeUndefined();
    expect(coerceNotification({ ...valid, href: '//evil.example' })?.href).toBeUndefined();
    expect(coerceNotification({ ...valid, href: 'javascript:alert(1)' })?.href).toBeUndefined();
    expect(coerceNotification({ ...valid, href: '/permits' })?.href).toBe('/permits');
  });
});

const seed = (overrides: Partial<AppNotification>[] = []): AppNotification[] =>
  overrides.map((o, i) => ({
    id: `n${i}`, kind: 'system', severity: 'info',
    title: `Item ${i}`, read: false, createdAt: 1_700_000_000_000 + i,
    ...o,
  }));

describe('optimistic mutations', () => {
  // No signed-in user in this environment, so the store skips every network
  // call — which isolates exactly what we want to assert: the local half is
  // synchronous and complete on its own.
  beforeEach(() => {
    useNotificationStore.setState({
      notifications: seed([{}, {}, { read: true }]),
      enabled: true,
    });
  });

  it('markRead flips one row and leaves the rest alone', () => {
    useNotificationStore.getState().markRead('n0');
    const list = useNotificationStore.getState().notifications;
    expect(list.find((n) => n.id === 'n0')!.read).toBe(true);
    expect(list.find((n) => n.id === 'n1')!.read).toBe(false);
  });

  it('markRead on an already-read row is a no-op', () => {
    const before = useNotificationStore.getState().notifications;
    useNotificationStore.getState().markRead('n2');
    expect(useNotificationStore.getState().notifications).toBe(before);
  });

  it('markAllRead clears the unread count', () => {
    useNotificationStore.getState().markAllRead();
    expect(useNotificationStore.getState().notifications.every((n) => n.read)).toBe(true);
  });

  it('dismiss removes exactly one row', () => {
    useNotificationStore.getState().dismiss('n1');
    const ids = useNotificationStore.getState().notifications.map((n) => n.id);
    expect(ids).toEqual(['n0', 'n2']);
  });

  it('clearAll empties the list', () => {
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('mute is presentation-only — it never drops or hides a notification', () => {
    useNotificationStore.getState().setEnabled(false);
    expect(useNotificationStore.getState().enabled).toBe(false);
    expect(useNotificationStore.getState().notifications).toHaveLength(3);
  });
});

describe('hydrate — offline-first', () => {
  it('is a no-op for a guest and never clears the cached list', async () => {
    useNotificationStore.setState({ notifications: seed([{}, {}]) });
    await useNotificationStore.getState().hydrate();
    // No session → no fetch, and critically the cache survives. Clearing here
    // would make the bell claim "all caught up" on the strength of not asking.
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
  });
});
