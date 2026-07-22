// @vitest-environment jsdom
/**
 * Notification delivery resolution — the governance heart of the scheme.
 *
 * `resolveDelivery(mode, userPref)` is the single source of truth for "does
 * this member receive this kind?" (org policy vs member preference), and
 * push() must honor it: forced_off / opted-out kinds are never recorded, while
 * the master mute only silences the ping (still records).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveDelivery, useNotificationStore, type NotificationPolicy } from '../useNotificationStore';

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

const basePolicy = (): NotificationPolicy => ({
  calc: 'user_choice', permit: 'user_choice', team: 'user_choice',
  community: 'user_choice', security: 'user_choice', system: 'user_choice',
});
const allPrefsOn = () => ({
  calc: true, permit: true, team: true, community: true, security: true, system: true,
});

describe('useNotificationStore.push — delivery gating', () => {
  beforeEach(() => {
    useNotificationStore.setState({
      notifications: [],
      enabled: true,
      userPrefs: allPrefsOn(),
      orgPolicy: basePolicy(),
      orgPolicyLoaded: true,
    });
  });

  it('drops a kind the member opted out of (user_choice + pref off)', () => {
    useNotificationStore.setState({ userPrefs: { ...allPrefsOn(), calc: false } });
    useNotificationStore.getState().push({ kind: 'calc', title: 'Calc done' });
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('records a forced_on kind even when the member opted out (admin ultimately decides)', () => {
    useNotificationStore.setState({
      orgPolicy: { ...basePolicy(), security: 'forced_on' },
      userPrefs: { ...allPrefsOn(), security: false },
    });
    useNotificationStore.getState().push({ kind: 'security', title: 'Access changed' });
    const list = useNotificationStore.getState().notifications;
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('security');
  });

  it('drops a forced_off kind even when the member wants it', () => {
    useNotificationStore.setState({
      orgPolicy: { ...basePolicy(), community: 'forced_off' },
      userPrefs: { ...allPrefsOn(), community: true },
    });
    useNotificationStore.getState().push({ kind: 'community', title: 'New reply' });
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('records a user_choice kind the member left on', () => {
    useNotificationStore.getState().push({ kind: 'permit', title: 'Permit approved' });
    const list = useNotificationStore.getState().notifications;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Permit approved');
  });

  it('mute (enabled=false) still records — it only suppresses the ping', () => {
    useNotificationStore.setState({ enabled: false });
    useNotificationStore.getState().push({ kind: 'system', title: 'Quiet note' });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });
});
