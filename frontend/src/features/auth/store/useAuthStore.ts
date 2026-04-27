import { create } from 'zustand';
import { registerAuthGetter } from '../../../utils/storage';

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
  /**
   * Creator-layer flag (L0). Orthogonal to `role` — platform admins can
   * also be regular admins of their own tenant org. When true, the avatar
   * menu surfaces the /admin link and platform.* API calls are unlocked.
   */
  isPlatformAdmin?: boolean;
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

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<{ data?: T; error?: string; status: number }> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> || {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error || `HTTP ${res.status}`, status: res.status, data: body as T };
    return { data: body as T, status: res.status };
  } catch {
    return { error: 'Unable to reach server. Please check your connection and try again.', status: 0 };
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────
interface AuthState {
  user: User | null;
  organisation: Organisation | null;
  token: string | null;
  isAuthenticated: boolean;
  isOnboarding: boolean;
  authError: string | null;
  authLoading: boolean;

  // Email verification state
  pendingVerification: boolean;
  pendingEmail: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; firstName: string; lastName: string; orgName?: string; orgType?: OrgType; regionCode?: RegionCode; addressLine1?: string; city?: string; state?: string; zip?: string; country?: string; phone?: string }) => Promise<void>;
  logout: () => void;
  setAuthenticated: (isAuthenticated: boolean) => void;
  setOnboarding: (isOnboarding: boolean) => void;
  restoreSession: () => Promise<void>;
  clearError: () => void;

  // Verification & password reset actions
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<boolean>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<boolean>;

  // SSO actions
  ssoMicrosoft: () => Promise<void>;
  ssoCloudflare: () => Promise<void>;
  ssoCallback: (code: string, provider?: 'microsoft' | 'cloudflare') => Promise<void>;
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
  pendingVerification: false,
  pendingEmail: null,

  login: async (email, password) => {
    set({ authLoading: true, authError: null });

    const { data, error, status } = await apiFetch<{ token?: string; user?: User; organisation?: Organisation; pendingVerification?: boolean; email?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    // Handle unverified account — redirect to verification
    if (status === 403 && data?.pendingVerification) {
      set({
        authLoading: false,
        authError: null,
        pendingVerification: true,
        pendingEmail: data.email || email.toLowerCase().trim(),
      });
      return;
    }

    if (error || !data?.token) {
      set({ authLoading: false, authError: error || 'Login failed. Please try again.' });
      return;
    }

    persistSession(data.token, data.user!, data.organisation!);
    set({
      user: data.user!,
      organisation: data.organisation!,
      token: data.token,
      isAuthenticated: true,
      authLoading: false,
      authError: null,
      pendingVerification: false,
      pendingEmail: null,
    });
  },

  register: async (data) => {
    set({ authLoading: true, authError: null });

    const { data: resp, error } = await apiFetch<{ token?: string; user?: User; organisation?: Organisation; pendingVerification?: boolean; email?: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (error && !resp?.pendingVerification) {
      set({ authLoading: false, authError: error || 'Registration failed. Please try again.' });
      return;
    }

    // Registration now returns pendingVerification instead of a session
    if (resp?.pendingVerification) {
      set({
        authLoading: false,
        authError: null,
        pendingVerification: true,
        pendingEmail: resp.email || data.email.toLowerCase().trim(),
      });
      return;
    }

    // Fallback: if server returns a full session (shouldn't happen but be safe)
    if (resp?.token && resp.user && resp.organisation) {
      persistSession(resp.token, resp.user, resp.organisation);
      set({
        user: resp.user,
        organisation: resp.organisation,
        token: resp.token,
        isAuthenticated: true,
        authLoading: false,
        authError: null,
      });
    }
  },

  verifyEmail: async (email, code) => {
    set({ authLoading: true, authError: null });

    const { data, error } = await apiFetch<{ token: string; user: User; organisation: Organisation }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });

    if (error || !data) {
      set({ authLoading: false, authError: error || 'Verification failed. Please try again.' });
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
      pendingVerification: false,
      pendingEmail: null,
    });
  },

  resendVerification: async (email) => {
    set({ authError: null });

    const { error } = await apiFetch('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });

    if (error) {
      set({ authError: error });
    }
  },

  forgotPassword: async (email) => {
    set({ authLoading: true, authError: null });

    const { error } = await apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });

    set({ authLoading: false });

    if (error) {
      set({ authError: error });
      return false;
    }
    return true;
  },

  resetPassword: async (email, code, newPassword) => {
    set({ authLoading: true, authError: null });

    const { error } = await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword }),
    });

    set({ authLoading: false });

    if (error) {
      set({ authError: error });
      return false;
    }
    return true;
  },

  ssoMicrosoft: async () => {
    set({ authLoading: true, authError: null });

    const { data, error } = await apiFetch<{ url: string; state: string }>('/api/auth/sso/microsoft/url');

    if (error || !data) {
      set({ authLoading: false, authError: error || 'Failed to initiate Microsoft sign-in.' });
      return;
    }

    try {
      sessionStorage.setItem('hvac_sso_state', data.state);
      sessionStorage.setItem('hvac_sso_provider', 'microsoft');
    } catch { /* ok */ }

    window.location.href = data.url;
  },

  ssoCloudflare: async () => {
    set({ authLoading: true, authError: null });

    const { data, error } = await apiFetch<{ url: string; state: string }>('/api/auth/sso/cloudflare/url');

    if (error || !data) {
      set({ authLoading: false, authError: error || 'Failed to initiate SSO sign-in.' });
      return;
    }

    try {
      sessionStorage.setItem('hvac_sso_state', data.state);
      sessionStorage.setItem('hvac_sso_provider', 'cloudflare');
    } catch { /* ok */ }

    window.location.href = data.url;
  },

  ssoCallback: async (code, provider) => {
    set({ authLoading: true, authError: null });

    // Determine which provider to use
    const ssoProvider = provider || (() => {
      try { return sessionStorage.getItem('hvac_sso_provider') as 'microsoft' | 'cloudflare' | null; } catch { return null; }
    })() || 'microsoft';

    const callbackUrl = ssoProvider === 'cloudflare'
      ? '/api/auth/sso/cloudflare/callback'
      : '/api/auth/sso/microsoft/callback';

    const { data, error } = await apiFetch<{ token: string; user: User; organisation: Organisation }>(callbackUrl, {
      method: 'POST',
      body: JSON.stringify({ code }),
    });

    if (error || !data) {
      set({ authLoading: false, authError: error || 'Microsoft sign-in failed. Please try again.' });
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
      pendingVerification: false,
      pendingEmail: null,
    });
  },

  logout: () => {
    const token = get().token;
    if (token) {
      apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    }
    clearPersistedSession();
    set({ user: null, organisation: null, token: null, isAuthenticated: false, isOnboarding: false, authError: null, pendingVerification: false, pendingEmail: null });
  },

  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  setOnboarding: (isOnboarding) => set({ isOnboarding }),

  restoreSession: async () => {
    const saved = loadPersistedSession();
    if (!saved) return;

    // Validate token with backend
    const { data, error } = await apiFetch<{ user: User; organisation: Organisation }>('/api/auth/me');
    if (error || !data) {
      // Token expired or server error → clear session and require re-login
      // Network errors: keep session alive (offline-capable PWA)
      if (error && !error.includes('Unable to reach server')) {
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

// Register user getter for scoped localStorage keys
registerAuthGetter(() => useAuthStore.getState().user);
