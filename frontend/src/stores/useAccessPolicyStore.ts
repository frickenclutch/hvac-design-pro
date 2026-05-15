/**
 * Access-policy capability cache.
 *
 * The server is the source of truth — every gated endpoint re-checks the
 * policy. This store exists purely so the UI can hide surfaces the caller
 * can't use (defense-in-depth + clean UX), without each component doing
 * its own fetch + role math.
 *
 * Capabilities default to the most permissive view-side / least
 * permissive write-side state until the real policy loads, so the UI
 * doesn't flash-hide-then-show. `loaded` lets components decide whether
 * to render a skeleton vs. commit to a gated layout.
 */

import { create } from 'zustand';
import { api } from '../lib/api';

export interface AccessCapabilities {
  canViewVersions: boolean;
  canRestoreVersions: boolean;
  canViewAudit: boolean;
  canEditPolicy: boolean;
}

export interface AccessPolicy {
  versionView: string;
  versionRestore: string;
  auditView: string;
}

interface AccessPolicyState {
  policy: AccessPolicy | null;
  capabilities: AccessCapabilities;
  loaded: boolean;
  loading: boolean;
  /** Fetch (or refetch) the policy + capabilities for the current session.
   *  Safe to call repeatedly — coalesces concurrent calls. */
  refresh: () => Promise<void>;
  /** Drop cached policy on logout / org switch so the next session
   *  doesn't see the previous tenant's capabilities. */
  reset: () => void;
}

// Conservative pre-load defaults: assume audit/restore are NOT allowed
// (hide the surface until proven), but version VIEW defaults true so the
// CAD history icon doesn't flicker for the common case.
const DEFAULT_CAPS: AccessCapabilities = {
  canViewVersions: true,
  canRestoreVersions: false,
  canViewAudit: false,
  canEditPolicy: false,
};

let inFlight: Promise<void> | null = null;

export const useAccessPolicyStore = create<AccessPolicyState>((set) => ({
  policy: null,
  capabilities: DEFAULT_CAPS,
  loaded: false,
  loading: false,

  refresh: async () => {
    if (inFlight) return inFlight;
    set({ loading: true });
    inFlight = (async () => {
      try {
        const res = await api.getAccessPolicy();
        set({
          policy: res.policy,
          capabilities: res.capabilities,
          loaded: true,
          loading: false,
        });
      } catch {
        // On failure keep conservative defaults. The server still
        // enforces the real policy on every call, so a failed capability
        // fetch just means some buttons stay hidden — fail safe.
        set({ loaded: true, loading: false });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  reset: () => {
    inFlight = null;
    set({ policy: null, capabilities: DEFAULT_CAPS, loaded: false, loading: false });
  },
}));
