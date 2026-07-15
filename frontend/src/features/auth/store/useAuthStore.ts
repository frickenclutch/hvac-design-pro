import { create } from 'zustand';
import { registerAuthGetter } from '../../../utils/storage';
import { api } from '../../../lib/api';
import { toast } from '../../../stores/useToastStore';

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
  /**
   * Permit-authority flag. Orthogonal to `role`, mirrors `isPlatformAdmin`.
   * Set on inspectors / plan reviewers / code enforcement officers within
   * a tenant configured with an `authority_type`. Surfaces the /permits
   * sidebar link and unlocks decision actions on incoming submissions.
   */
  isPermitAuthority?: boolean;
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
const REFRESH_KEY = 'hvac_refresh_token';
const USER_KEY = 'hvac_session_user';
const ORG_KEY = 'hvac_session_org';
// While an L0 admin impersonates a tenant, their REAL credential set +
// user/org snapshot live here; the impersonation token occupies the normal
// keys so every existing request path works unchanged. Exit (or the
// impersonation token's 30-min death) restores from this stash.
const IMPERSONATION_STASH_KEY = 'hvac_impersonation_stash';
// Project list cache — cleared on any org-context switch so one org's
// projects never bleed into another's UI.
const PROJECTS_CACHE_KEY = 'hvac_projects';

interface ImpersonationStash {
  token: string;
  refreshToken: string | null;
  user: User;
  org: Organisation;
}

function readStash(): ImpersonationStash | null {
  try {
    const raw = localStorage.getItem(IMPERSONATION_STASH_KEY);
    return raw ? JSON.parse(raw) as ImpersonationStash : null;
  } catch { return null; }
}

function persistSession(token: string, user: User, org: Organisation, refreshToken?: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(ORG_KEY, JSON.stringify(org));
    // Only overwrite the refresh token when a new one is issued (login /
    // rotation). Re-validation via /me supplies none — preserve the existing.
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch { /* storage full */ }
}

function clearPersistedSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
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

  // ── MFA second-factor state ──────────────────────────────────────────────
  // Set when a login returns 202 (enrolled user must complete a challenge) or
  // 403 (required-but-not-enrolled user must enroll in a grace flow). Both are
  // cleared on a successful session mint and on logout. The tokens are opaque,
  // single-use, server-hashed — they are NOT session credentials.
  mfaRequired: boolean;
  mfaChallengeToken: string | null;
  mfaMethods: string[];
  enrollmentRequired: boolean;
  mfaEnrollToken: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; firstName: string; lastName: string; orgName?: string; orgType?: OrgType; regionCode?: RegionCode; addressLine1?: string; city?: string; state?: string; zip?: string; country?: string; phone?: string }) => Promise<void>;
  logout: () => void;
  setAuthenticated: (isAuthenticated: boolean) => void;
  setOnboarding: (isOnboarding: boolean) => void;
  restoreSession: () => Promise<void>;
  clearError: () => void;

  // MFA actions (pre-session — routed through the store's own apiFetch, which
  // does NOT auto-refresh/retry on 401, exactly like login).
  submitMfaChallenge: (code: string, method: 'totp' | 'email' | 'backup') => Promise<void>;
  sendMfaEmailCode: () => Promise<boolean>;
  enrollGrace: () => Promise<{ secret: string; otpauthUri: string } | null>;
  confirmEnrollGrace: (code: string) => Promise<string[] | null>;

  // Verification & password reset actions
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<boolean>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<boolean>;

  // SSO actions
  ssoMicrosoft: () => Promise<void>;
  ssoCloudflare: () => Promise<void>;
  ssoCallback: (code: string, provider?: 'microsoft' | 'cloudflare') => Promise<void>;

  // Invite redemption — accepts a pending org_invites token, creates the
  // user inside the inviter's tenant, and immediately authenticates them.
  // The recipient is marked verified on creation (the email link itself
  // is proof of email ownership, so no second OTP loop).
  redeemInvite: (token: string, data: { firstName: string; lastName: string; password: string }) => Promise<void>;

  // ── L0 org impersonation ───────────────────────────────────────────────
  // True while the active session is a read-only impersonation of another
  // tenant. The admin's real credentials are stashed and restored on exit
  // or when the impersonation token dies at its 30-minute TTL.
  impersonating: boolean;
  /** Swap into a read-only session for the target org. Returns true on
   *  success — the caller should then hard-navigate so every store
   *  re-initializes under the new org context. */
  enterImpersonation: (orgId: string) => Promise<boolean>;
  /** Kill the impersonation session and restore the stashed real session. */
  exitImpersonation: () => Promise<void>;

  // Reparent consent — adopt the fresh session returned by
  // api.authTransferAccept (my account just moved orgs; all old tokens are
  // dead). Caller hard-navigates afterwards for a clean store reset.
  adoptTransferredSession: (resp: {
    token: string; refreshToken: string;
    user: User; organisation: Organisation;
  }) => void;
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
  mfaRequired: false,
  mfaChallengeToken: null,
  mfaMethods: [],
  enrollmentRequired: false,
  mfaEnrollToken: null,
  // A surviving stash means the persisted session IS an impersonation.
  impersonating: !!readStash(),

  login: async (email, password) => {
    set({ authLoading: true, authError: null });

    const { data, error, status } = await apiFetch<{ token?: string; refreshToken?: string; user?: User; organisation?: Organisation; pendingVerification?: boolean; email?: string; mfaRequired?: boolean; mfaChallengeToken?: string; methods?: string[]; enrollmentRequired?: boolean; mfaEnrollToken?: string }>('/api/auth/login', {
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

    // ── MFA second-factor required (enrolled user) — 202, NO session ────────
    // Must return BEFORE the "no token == failure" check below.
    if (status === 202 && data?.mfaRequired && data.mfaChallengeToken) {
      set({
        authLoading: false,
        authError: null,
        mfaRequired: true,
        mfaChallengeToken: data.mfaChallengeToken,
        mfaMethods: data.methods ?? ['totp'],
        pendingEmail: data.email || email.toLowerCase().trim(),
        enrollmentRequired: false,
        mfaEnrollToken: null,
      });
      return;
    }

    // ── Forced enrollment (required role, not yet enrolled) — 403, NO session ─
    if (status === 403 && data?.enrollmentRequired && data.mfaEnrollToken) {
      set({
        authLoading: false,
        authError: null,
        enrollmentRequired: true,
        mfaEnrollToken: data.mfaEnrollToken,
        pendingEmail: data.email || email.toLowerCase().trim(),
        mfaRequired: false,
        mfaChallengeToken: null,
      });
      return;
    }

    if (error || !data?.token) {
      set({ authLoading: false, authError: error || 'Login failed. Please try again.' });
      return;
    }

    persistSession(data.token, data.user!, data.organisation!, data.refreshToken);
    set({
      user: data.user!,
      organisation: data.organisation!,
      token: data.token,
      isAuthenticated: true,
      authLoading: false,
      authError: null,
      pendingVerification: false,
      pendingEmail: null,
      mfaRequired: false,
      mfaChallengeToken: null,
      mfaMethods: [],
      enrollmentRequired: false,
      mfaEnrollToken: null,
    });
  },

  submitMfaChallenge: async (code, method) => {
    const challengeToken = get().mfaChallengeToken;
    if (!challengeToken) {
      set({ authError: 'Your sign-in session expired. Please sign in again.' });
      return;
    }
    set({ authLoading: true, authError: null });

    const { data, error } = await apiFetch<{ token?: string; refreshToken?: string; user?: User; organisation?: Organisation }>('/api/auth/mfa/challenge', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, code, method }),
    });

    if (error || !data?.token) {
      set({ authLoading: false, authError: error || 'Invalid code. Please try again.' });
      return;
    }

    persistSession(data.token, data.user!, data.organisation!, data.refreshToken);
    set({
      user: data.user!,
      organisation: data.organisation!,
      token: data.token,
      isAuthenticated: true,
      authLoading: false,
      authError: null,
      pendingVerification: false,
      pendingEmail: null,
      mfaRequired: false,
      mfaChallengeToken: null,
      mfaMethods: [],
      enrollmentRequired: false,
      mfaEnrollToken: null,
    });
  },

  sendMfaEmailCode: async () => {
    const challengeToken = get().mfaChallengeToken;
    if (!challengeToken) return false;
    const { error } = await apiFetch('/api/auth/mfa/email-code', {
      method: 'POST',
      body: JSON.stringify({ challengeToken }),
    });
    if (error) {
      set({ authError: error });
      return false;
    }
    return true;
  },

  enrollGrace: async () => {
    const mfaEnrollToken = get().mfaEnrollToken;
    if (!mfaEnrollToken) {
      set({ authError: 'Your enrollment session expired. Please sign in again.' });
      return null;
    }
    set({ authLoading: true, authError: null });
    const { data, error } = await apiFetch<{ secret?: string; otpauthUri?: string }>('/api/auth/mfa/enroll-grace', {
      method: 'POST',
      body: JSON.stringify({ mfaEnrollToken }),
    });
    set({ authLoading: false });
    if (error || !data?.secret || !data.otpauthUri) {
      set({ authError: error || 'Could not start enrollment. Please sign in again.' });
      return null;
    }
    return { secret: data.secret, otpauthUri: data.otpauthUri };
  },

  confirmEnrollGrace: async (code) => {
    const mfaEnrollToken = get().mfaEnrollToken;
    if (!mfaEnrollToken) {
      set({ authError: 'Your enrollment session expired. Please sign in again.' });
      return null;
    }
    set({ authLoading: true, authError: null });
    const { data, error } = await apiFetch<{ token?: string; refreshToken?: string; user?: User; organisation?: Organisation; backupCodes?: string[] }>('/api/auth/mfa/confirm-grace', {
      method: 'POST',
      body: JSON.stringify({ mfaEnrollToken, code }),
    });
    if (error || !data?.token) {
      set({ authLoading: false, authError: error || 'Invalid code. Please try again.' });
      return null;
    }
    persistSession(data.token, data.user!, data.organisation!, data.refreshToken);
    set({
      user: data.user!,
      organisation: data.organisation!,
      token: data.token,
      isAuthenticated: true,
      authLoading: false,
      authError: null,
      pendingVerification: false,
      pendingEmail: null,
      mfaRequired: false,
      mfaChallengeToken: null,
      mfaMethods: [],
      enrollmentRequired: false,
      mfaEnrollToken: null,
    });
    return data.backupCodes ?? [];
  },

  register: async (data) => {
    set({ authLoading: true, authError: null });

    const { data: resp, error } = await apiFetch<{ token?: string; refreshToken?: string; user?: User; organisation?: Organisation; pendingVerification?: boolean; email?: string }>('/api/auth/register', {
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
      persistSession(resp.token, resp.user, resp.organisation, resp.refreshToken);
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

    const { data, error } = await apiFetch<{ token: string; refreshToken?: string; user: User; organisation: Organisation }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });

    if (error || !data) {
      set({ authLoading: false, authError: error || 'Verification failed. Please try again.' });
      return;
    }

    persistSession(data.token, data.user, data.organisation, data.refreshToken);
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

    const { data, error } = await apiFetch<{ token: string; refreshToken?: string; user: User; organisation: Organisation }>(callbackUrl, {
      method: 'POST',
      body: JSON.stringify({ code }),
    });

    if (error || !data) {
      set({ authLoading: false, authError: error || 'Microsoft sign-in failed. Please try again.' });
      return;
    }

    persistSession(data.token, data.user, data.organisation, data.refreshToken);
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

  redeemInvite: async (token, data) => {
    set({ authLoading: true, authError: null });

    const { data: resp, error } = await apiFetch<{ token: string; refreshToken?: string; user: User; organisation: Organisation }>(
      `/api/auth/invite/${encodeURIComponent(token)}/redeem`,
      { method: 'POST', body: JSON.stringify(data) },
    );

    if (error || !resp?.token) {
      set({ authLoading: false, authError: error || 'Could not redeem invitation. Please try again.' });
      return;
    }

    persistSession(resp.token, resp.user, resp.organisation, resp.refreshToken);
    set({
      user: resp.user,
      organisation: resp.organisation,
      token: resp.token,
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
    // Deliberate full logout also abandons any impersonation stash — the
    // user asked to sign out, not to fall back to the stashed session.
    localStorage.removeItem(IMPERSONATION_STASH_KEY);
    set({ user: null, organisation: null, token: null, isAuthenticated: false, isOnboarding: false, authError: null, pendingVerification: false, pendingEmail: null, mfaRequired: false, mfaChallengeToken: null, mfaMethods: [], enrollmentRequired: false, mfaEnrollToken: null, impersonating: false });
  },

  enterImpersonation: async (orgId) => {
    const { user, organisation, token } = get();
    if (!user?.isPlatformAdmin || !token || !organisation) return false;
    if (get().impersonating) return false;

    let resp: Awaited<ReturnType<typeof api.platformImpersonateOrg>>;
    try {
      resp = await api.platformImpersonateOrg(orgId);
    } catch {
      return false; // api.ts already toasted the server error
    }

    // Stash the REAL credential set + identity snapshot, then remove the
    // refresh token from the live keys — a silent refresh mid-impersonation
    // would mint an ADMIN-org access token and silently break the view.
    const stash: ImpersonationStash = {
      token,
      refreshToken: localStorage.getItem(REFRESH_KEY),
      user,
      org: organisation,
    };
    try { localStorage.setItem(IMPERSONATION_STASH_KEY, JSON.stringify(stash)); } catch { return false; }
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(PROJECTS_CACHE_KEY);

    const targetOrg: Organisation = {
      id: resp.organisation.id,
      name: resp.organisation.name,
      type: resp.organisation.type as OrgType,
      slug: resp.organisation.slug,
      regionCode: resp.organisation.regionCode as RegionCode,
    };
    api.setToken(resp.token);
    persistSession(resp.token, user, targetOrg);
    set({ token: resp.token, organisation: targetOrg, impersonating: true });
    return true;
  },

  exitImpersonation: async () => {
    // Kill the impersonation session server-side FIRST — this needs the
    // impersonation bearer, which is still in the live keys. Best-effort:
    // an already-expired token just means the row is gone anyway.
    try { await api.platformExitImpersonation(); } catch { /* expired/dead */ }
    restoreStashedSession();
    localStorage.removeItem(PROJECTS_CACHE_KEY);
    await get().restoreSession();
  },

  adoptTransferredSession: (resp) => {
    api.setTokens(resp.token, resp.refreshToken);
    persistSession(resp.token, resp.user, resp.organisation, resp.refreshToken);
    // Old org's cached project list must not bleed into the new org.
    localStorage.removeItem(PROJECTS_CACHE_KEY);
    set({
      user: resp.user,
      organisation: resp.organisation,
      token: resp.token,
      isAuthenticated: true,
      authError: null,
    });
  },

  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  setOnboarding: (isOnboarding) => set({ isOnboarding }),

  restoreSession: async () => {
    const saved = loadPersistedSession();
    if (!saved) return;

    // Validate the access token. With short-lived access tokens it may have
    // expired since the last visit — a 401 triggers one silent refresh (using
    // the stored refresh token) before we give up on the session.
    let { data, error, status } = await apiFetch<{ user: User; organisation: Organisation }>('/api/auth/me');
    if (status === 401) {
      const outcome = await api.refreshSession();
      // Transient = the refresh endpoint was unreachable, NOT a dead
      // session. Keep the persisted session (offline-capable PWA) — the
      // next heartbeat retries. Only a definitive rejection falls through
      // to the clear below.
      if (outcome === 'transient') return;
      if (outcome === 'ok') {
        ({ data, error, status } = await apiFetch<{ user: User; organisation: Organisation }>('/api/auth/me'));
      }
    }
    if (error || !data) {
      // Real auth failure (a 401 that refresh couldn't rescue) → clear.
      // Network errors keep the session alive (offline-capable PWA).
      if (error && !error.includes('Unable to reach server')) {
        clearPersistedSession();
        set({ user: null, organisation: null, token: null, isAuthenticated: false });
      }
      return;
    }

    // Use the current (possibly just-refreshed) access token, not the stale
    // one loaded at the top of this function.
    const currentToken = localStorage.getItem(TOKEN_KEY) ?? saved.token;
    persistSession(currentToken, data.user, data.organisation);
    set({ user: data.user, organisation: data.organisation, token: currentToken, isAuthenticated: true });
  },

  clearError: () => set({ authError: null }),
}));

// Register user getter for scoped localStorage keys
registerAuthGetter(() => useAuthStore.getState().user);

/**
 * Restore the admin's real session from the impersonation stash. Returns
 * true if a stash existed and was restored. Shared by the explicit exit
 * action and the terminal-401 handler (the impersonation token hard-dies
 * at its 30-minute TTL with no refresh token — that 401 must fall back to
 * the stashed session, not log the admin out).
 */
function restoreStashedSession(): boolean {
  const stash = readStash();
  if (!stash) return false;
  localStorage.removeItem(IMPERSONATION_STASH_KEY);
  if (stash.refreshToken) {
    api.setTokens(stash.token, stash.refreshToken);
  } else {
    api.setToken(stash.token);
  }
  persistSession(stash.token, stash.user, stash.org, stash.refreshToken ?? undefined);
  useAuthStore.setState({
    user: stash.user,
    organisation: stash.org,
    token: stash.token,
    isAuthenticated: true,
    impersonating: false,
  });
  return true;
}

// Terminal 401 (refresh definitively rejected): flip the app to logged-out
// exactly once so the route guard redirects to the login surface. Without
// this the auth store kept isAuthenticated=true after api.ts dropped the
// tokens, leaving a zombie UI where every click re-toasted "Session expired".
//
// Impersonation exception: the impersonation token has NO refresh token, so
// its 30-minute death lands here. Fall back to the admin's stashed real
// session instead of logging out, then hard-navigate so every store
// re-initializes under the admin's own org context.
api.onSessionExpired(() => {
  if (restoreStashedSession()) {
    localStorage.removeItem(PROJECTS_CACHE_KEY);
    toast.info('Impersonation session ended — you are back in your own workspace.');
    void useAuthStore.getState().restoreSession();
    window.location.assign('/admin');
    return;
  }
  clearPersistedSession();
  useAuthStore.setState({
    user: null, organisation: null, token: null, isAuthenticated: false,
    mfaRequired: false, mfaChallengeToken: null, mfaMethods: [],
    enrollmentRequired: false, mfaEnrollToken: null,
  });
});
