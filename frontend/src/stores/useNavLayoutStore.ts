// Tenant navigation layout — the org's sidebar arrangement, landing page, and
// rail defaults, set by the tenant admin (or L0). Server is the source of
// truth (organisations.settings.navLayout); this store keeps a last-good copy
// per org in localStorage (`hvac_navlayout_<orgId>`) so the tenant's sidebar is
// right on the first frame after a reload and still right offline.
//
// Mirrors useBrandingStore deliberately — same lifecycle, same org-following.

import { create } from 'zustand';
import { api } from '../lib/api';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { coerceNavLayout, defaultNavLayout, type NavLayout } from '../lib/navLayout';

const cacheKey = (orgId: string) => `hvac_navlayout_${orgId}`;

function loadCache(orgId: string | null): NavLayout {
  if (!orgId) return defaultNavLayout();
  try {
    const raw = localStorage.getItem(cacheKey(orgId));
    return raw ? coerceNavLayout(JSON.parse(raw)) : defaultNavLayout();
  } catch {
    return defaultNavLayout();
  }
}

function saveCache(orgId: string, layout: NavLayout) {
  try { localStorage.setItem(cacheKey(orgId), JSON.stringify(layout)); } catch { /* quota — degrade silently */ }
}

interface NavLayoutStore {
  layout: NavLayout;
  canEdit: boolean;
  /** Org id the server copy was last confirmed for (null until first fetch). */
  confirmedFor: string | null;
  /** Pull the server copy. Failure keeps the last-good cache (offline-first). */
  refresh: () => Promise<void>;
  /** Adopt a layout the server just returned from a write. */
  adopt: (layout: NavLayout) => void;
}

const bootOrgId = useAuthStore.getState().organisation?.id ?? null;
let inFlight: Promise<void> | null = null;

export const useNavLayoutStore = create<NavLayoutStore>((set) => ({
  layout: loadCache(bootOrgId),
  canEdit: false,
  confirmedFor: null,

  refresh: async () => {
    if (inFlight) return inFlight;
    const orgId = useAuthStore.getState().organisation?.id ?? null;
    if (!orgId) return;
    inFlight = (async () => {
      try {
        const res = await api.getNavLayout();
        // The org may have changed (logout / impersonation) while in flight.
        if (useAuthStore.getState().organisation?.id !== orgId) return;
        const layout = coerceNavLayout(res.layout);
        saveCache(orgId, layout);
        set({ layout, canEdit: res.canEdit, confirmedFor: orgId });
      } catch {
        /* keep last-good cached layout */
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  adopt: (incoming) => {
    const layout = coerceNavLayout(incoming);
    const orgId = useAuthStore.getState().organisation?.id ?? null;
    if (orgId) saveCache(orgId, layout);
    set({ layout });
  },
}));

// Follow the org: login, logout, and L0 impersonation all change it.
let lastOrgId: string | null = bootOrgId;
useAuthStore.subscribe((state) => {
  const orgId = state.organisation?.id ?? null;
  if (orgId === lastOrgId) return;
  lastOrgId = orgId;
  inFlight = null;
  useNavLayoutStore.setState({ layout: loadCache(orgId), canEdit: false, confirmedFor: null });
  if (orgId) void useNavLayoutStore.getState().refresh();
});
