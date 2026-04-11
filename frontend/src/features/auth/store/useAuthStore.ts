import { create } from 'zustand';

export type UserRole = 'admin' | 'engineer' | 'tech' | 'viewer';
export type OrgType = 'individual' | 'company' | 'municipality';
export type RegionCode = 'NA_ASHRAE' | 'EU_EN' | 'UK_CIBSE';

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: Address;
  isVerified: boolean;
}

export interface Organisation {
  id: string;
  name: string;
  type: OrgType;
  slug: string;
  regionCode: RegionCode;
  address?: Address;
  phone?: string;
}

// ── Persistence ────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'hvac_session_token';
const USER_KEY = 'hvac_session_user';
const ORG_KEY = 'hvac_session_org';

function persistSession(token: string, user: User, org: Organisation) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(ORG_KEY, JSON.stringify(org));
  } catch { /* storage full */ }
}

function clearPersistedSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ORG_KEY);
}

function loadPersistedSession(): { token: string; user: User; org: Organisation } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = localStorage.getItem(USER_KEY);
    const org = localStorage.getItem(ORG_KEY);
    if (token && user && org) {
      return { token, user: JSON.parse(user), org: JSON.parse(org) };
    }
  } catch { /* corrupted */ }
  return null;
}

// ── API ────────────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/** True when we have a real backend URL configured (not just the static Pages origin). */
const HAS_BACKEND = !!import.meta.env.VITE_API_BASE_URL;

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<{ data?: T; error?: string; status: number }> {
  // If no backend is configured, skip the request entirely
  if (!HAS_BACKEND) return { error: '__no_backend__', status: 0 };

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> || {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error || `HTTP ${res.status}`, status: res.status };
    return { data: body as T, status: res.status };
  } catch {
    return { error: '__no_backend__', status: 0 };
  }
}

/** Check whether an error means "backend not available" (vs a real server error like 409 duplicate email). */
function isBackendUnavailable(error: string | undefined): boolean {
  return !error || error === '__no_backend__' || error.startsWith('Network error');
}

// ── Guest fallback ────────────────────────────────────────────────────────────
const guestUser: User = {
  id: 'guest',
  email: 'guest@designpro.app',
  role: 'admin',
  firstName: 'Guest',
  lastName: 'User',
  isVerified: true,
};

const guestOrg: Organisation = {
  id: 'org-default',
  name: 'DesignPro',
  type: 'individual',
  slug: 'designpro',
  regionCode: 'NA_ASHRAE',
};

// ── Store ──────────────────────────────────────────────────────────────────────
interface AuthState {
  user: User | null;
  organisation: Organisation | null;
  token: string | null;
  isAuthenticated: boolean;
  isOnboarding: boolean;
  authError: string | null;
  authLoading: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  loginAsGuest: () => void;
  register: (data: { email: string; password: string; firstName: string; lastName: string; orgName?: string; orgType?: OrgType; regionCode?: RegionCode }) => Promise<void>;
  logout: () => void;
  setAuthenticated: (isAuthenticated: boolean) => void;
  setOnboarding: (isOnboarding: boolean) => void;
  restoreSession: () => Promise<void>;
  clearError: () => void;
}

// Hydrate from persisted session on creation
const persisted = loadPersistedSession();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: persisted?.user ?? null,
  organisation: persisted?.org ?? null,
  token: persisted?.token ?? null,
  isAuthenticated: !!persisted,
  isOnboarding: false,
  authError: null,
  authLoading: false,

  login: async (email, password) => {
    set({ authLoading: true, authError: null });

    const { data, error } = await apiFetch<{ token: string; user: User; organisation: Organisation }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (error || !data) {
      // Fallback for offline/dev: if backend is unreachable, allow demo login
      if (isBackendUnavailable(error)) {
        const devUser: User = { id: 'user-dev', email, role: 'admin', firstName: email.split('@')[0], lastName: '', isVerified: true };
        persistSession('dev-token', devUser, guestOrg);
        set({ user: devUser, organisation: guestOrg, token: 'dev-token', isAuthenticated: true, authLoading: false, authError: null });
        return;
      }
      set({ authLoading: false, authError: error || 'Login failed' });
      return;
    }

    persistSession(data.token, data.user, data.organisation);
    set({
      user: data.user,
      organisation: data.organisation,
      token: data.token,
      isAuthenticated: true,
      authLoading: false,
      authError: null,
    });
  },

  loginAsGuest: () => {
    persistSession('guest-token', guestUser, guestOrg);
    set({
      user: guestUser,
      organisation: guestOrg,
      token: 'guest-token',
      isAuthenticated: true,
      authError: null,
    });
  },

  register: async (data) => {
    set({ authLoading: true, authError: null });

    const { data: resp, error } = await apiFetch<{ token: string; user: User; organisation: Organisation }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (error || !resp) {
      // Fallback for offline/dev
      if (isBackendUnavailable(error)) {
        const newUser: User = { id: 'user-new', email: data.email, role: 'admin', firstName: data.firstName, lastName: data.lastName, isVerified: true };
        const newOrg: Organisation = { id: 'org-new', name: data.orgName || `${data.firstName}'s Workspace`, type: data.orgType || 'individual', slug: data.firstName.toLowerCase(), regionCode: data.regionCode || 'NA_ASHRAE' };
        persistSession('dev-token', newUser, newOrg);
        set({ user: newUser, organisation: newOrg, token: 'dev-token', isAuthenticated: true, authLoading: false, authError: null });
        return;
      }
      set({ authLoading: false, authError: error || 'Registration failed' });
      return;
    }

    persistSession(resp.token, resp.user, resp.organisation);
    set({
      user: resp.user,
      organisation: resp.organisation,
      token: resp.token,
      isAuthenticated: true,
      authLoading: false,
      authError: null,
    });
  },

  logout: () => {
    const token = get().token;
    if (token && token !== 'guest-token' && token !== 'dev-token') {
      apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    }
    clearPersistedSession();
    set({ user: null, organisation: null, token: null, isAuthenticated: false, isOnboarding: false, authError: null });
  },

  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  setOnboarding: (isOnboarding) => set({ isOnboarding }),

  restoreSession: async () => {
    const saved = loadPersistedSession();
    if (!saved) return;

    // Validate token with backend
    const { data, error } = await apiFetch<{ user: User; organisation: Organisation }>('/api/auth/me');
    if (error || !data) {
      // Token expired or invalid — but don't log out if it's just a network error
      if (!isBackendUnavailable(error)) {
        clearPersistedSession();
        set({ user: null, organisation: null, token: null, isAuthenticated: false });
      }
      return;
    }

    persistSession(saved.token, data.user, data.organisation);
    set({ user: data.user, organisation: data.organisation, isAuthenticated: true });
  },

  clearError: () => set({ authError: null }),
}));
