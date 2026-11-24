// Tenant branding — the org's own name, tagline, colour and logo, set by the
// tenant admin (or L0) and applied to every member's session.
//
// The SERVER is the source of truth (organisations.settings.branding, see
// workers/src/utils/branding.ts). This store caches the last-good copy per org
// in localStorage so the tenant theme paints on the very first frame after a
// reload — no flash of the platform default — and survives being offline.
//
// The cache key is scoped by ORG id (`hvac_branding_<orgId>`): branding is a
// tenant-level fact, not a project-level one, and scoping by org is what stops
// one tenant's look bleeding into another's on a shared machine or during L0
// impersonation.

import { create } from 'zustand';
import { api } from '../lib/api';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { applyTenantPalette, normalizeHex } from '../lib/tenantTheme';
import { reapplyTheme } from './usePreferencesStore';

export interface TenantBranding {
  displayName: string | null;
  tagline: string | null;
  primaryColor: string | null;
  logoKey: string | null;
  whiteLabel: boolean;
}

export const DEFAULT_BRANDING: TenantBranding = {
  displayName: null,
  tagline: null,
  primaryColor: null,
  logoKey: null,
  whiteLabel: false,
};

export const PLATFORM_NAME = 'HVAC Design Pro';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const cacheKey = (orgId: string) => `hvac_branding_${orgId}`;

/** Public logo URL (an <img> can't send a bearer), or null when none is set.
 *  `logoKey` is only a cache-buster here — the server resolves the object. */
export function orgLogoUrl(orgId: string | null | undefined, logoKey: string | null | undefined): string | null {
  if (!orgId || !logoKey) return null;
  return `${API_BASE}/org-logos/${encodeURIComponent(orgId)}?v=${encodeURIComponent(logoKey)}`;
}

/** Never trust the cache blindly — it is user-writable storage. */
function coerce(raw: unknown): TenantBranding {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BRANDING };
  const r = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() && v.length <= 60 ? v : null);
  return {
    displayName: text(r.displayName),
    tagline: text(r.tagline),
    primaryColor: normalizeHex(r.primaryColor),
    logoKey: typeof r.logoKey === 'string' && r.logoKey ? r.logoKey : null,
    whiteLabel: r.whiteLabel === true,
  };
}

function loadCache(orgId: string | null): TenantBranding {
  if (!orgId) return { ...DEFAULT_BRANDING };
  try {
    const raw = localStorage.getItem(cacheKey(orgId));
    return raw ? coerce(JSON.parse(raw)) : { ...DEFAULT_BRANDING };
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}

function saveCache(orgId: string, branding: TenantBranding) {
  try { localStorage.setItem(cacheKey(orgId), JSON.stringify(branding)); } catch { /* quota — degrade silently */ }
}

/** Paint the palette, then let the preferences store re-assert everything it
 *  owns (it defers `--accent-rgb` to the tenant colour when one is active). */
function paint(branding: TenantBranding) {
  applyTenantPalette(branding.primaryColor);
  reapplyTheme();
  if (typeof document !== 'undefined') {
    // Default matches the static <title> in index.html exactly, so an
    // unbranded tab title never changes after load.
    document.title = productName();
  }
}

// ── Pre-auth (sign-in page) branding ────────────────────────────────────────
// Which tenant's look to wear before anyone has signed in, in priority order:
//   1. `?org=<slug>` on the URL — the tenant's own sign-in link
//      (an empty `?org=` explicitly asks for the platform's own page)
//   2. a `<slug>.hvacpro.app` hostname, once tenant subdomains are live
//   3. the tenant last signed in to on this device
// The server only ever returns the public identity a tenant chose for its
// shell (see workers routes/branding.ts publicBrandingRoutes).

const SIGNIN_SLUG_KEY = 'hvac_signin_org';
const publicCacheKey = (slug: string) => `hvac_branding_public_${slug}`;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TENANT_HOST_SUFFIX = '.hvacpro.app';

export interface SignInTenant {
  orgId: string;
  slug: string;
  name: string;
}

interface PublicCache { tenant: SignInTenant; branding: TenantBranding }

function readPublicCache(slug: string): PublicCache | null {
  try {
    const raw = localStorage.getItem(publicCacheKey(slug));
    if (!raw) return null;
    const r = JSON.parse(raw) as Record<string, unknown>;
    const t = (r.tenant ?? {}) as Record<string, unknown>;
    if (typeof t.orgId !== 'string' || !t.orgId || typeof t.name !== 'string') return null;
    return { tenant: { orgId: t.orgId, slug, name: t.name.slice(0, 120) }, branding: coerce(r.branding) };
  } catch {
    return null;
  }
}

function writePublicCache(entry: PublicCache | null, slug: string) {
  try {
    if (entry) localStorage.setItem(publicCacheKey(slug), JSON.stringify(entry));
    else localStorage.removeItem(publicCacheKey(slug));
  } catch { /* quota — degrade silently */ }
}

// A slug pinned for this page visit (in memory only) — an invitation's tenant.
let pinnedSlug: string | null = null;

/** The slug the sign-in page should wear, or null for the platform's own. */
export function signInSlug(): string | null {
  if (typeof window === 'undefined') return null;
  if (pinnedSlug) return pinnedSlug;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('org')) {
      const fromUrl = (params.get('org') ?? '').trim().toLowerCase();
      if (!fromUrl) { localStorage.removeItem(SIGNIN_SLUG_KEY); return null; }
      if (SLUG_RE.test(fromUrl)) return fromUrl;
    }
    const host = window.location.hostname.toLowerCase();
    if (host.endsWith(TENANT_HOST_SUFFIX)) {
      const sub = host.slice(0, -TENANT_HOST_SUFFIX.length);
      if (SLUG_RE.test(sub) && sub !== 'www' && sub !== 'app') return sub;
    }
    const remembered = localStorage.getItem(SIGNIN_SLUG_KEY);
    return remembered && SLUG_RE.test(remembered) ? remembered : null;
  } catch {
    return null;
  }
}

const hasBrand = (b: TenantBranding) => !!(b.displayName || b.logoKey || b.primaryColor);

/** After a signed-in refresh: remember this tenant for the next sign-in on
 *  this device (or forget it, if the tenant has since removed its branding). */
function rememberForSignIn(branding: TenantBranding) {
  const org = useAuthStore.getState().organisation;
  if (!org?.slug || !SLUG_RE.test(org.slug)) return;
  try {
    if (hasBrand(branding)) {
      localStorage.setItem(SIGNIN_SLUG_KEY, org.slug);
      writePublicCache({ tenant: { orgId: org.id, slug: org.slug, name: branding.displayName ?? org.name }, branding }, org.slug);
    } else if (localStorage.getItem(SIGNIN_SLUG_KEY) === org.slug) {
      localStorage.removeItem(SIGNIN_SLUG_KEY);
      writePublicCache(null, org.slug);
    }
  } catch { /* storage unavailable */ }
}

/** Signed-out state for the store: the cached sign-in tenant, or the platform. */
function signedOutState(): { branding: TenantBranding; signIn: SignInTenant | null } {
  const slug = signInSlug();
  const cached = slug ? readPublicCache(slug) : null;
  return cached ? { branding: cached.branding, signIn: cached.tenant } : { branding: { ...DEFAULT_BRANDING }, signIn: null };
}

interface BrandingStore {
  branding: TenantBranding;
  canEdit: boolean;
  canWhiteLabel: boolean;
  /** Set only while signed OUT: the tenant whose look the sign-in page wears. */
  signIn: SignInTenant | null;
  /** Pull the server copy. Failure keeps the last-good cache (offline-first). */
  refresh: () => Promise<void>;
  /** Signed out: resolve and load the sign-in tenant's public branding.
   *  Passing a slug (an invitation's tenant) pins it for this page visit. */
  loadPublic: (slug?: string) => Promise<void>;
  /** Adopt a branding object the server just returned from a write. */
  adopt: (branding: TenantBranding) => void;
  /** Live preview from the editor — repaints without saving or caching. */
  preview: (primaryColor: string | null) => void;
  /** Drop any preview and repaint the saved branding. */
  repaint: () => void;
}

const bootOrgId = useAuthStore.getState().organisation?.id ?? null;
const bootState = bootOrgId
  ? { branding: loadCache(bootOrgId), signIn: null as SignInTenant | null }
  : signedOutState();

let inFlight: Promise<void> | null = null;
let publicInFlight: Promise<void> | null = null;

export const useBrandingStore = create<BrandingStore>((set, get) => ({
  branding: bootState.branding,
  canEdit: false,
  canWhiteLabel: false,
  signIn: bootState.signIn,

  refresh: async () => {
    if (inFlight) return inFlight;
    const orgId = useAuthStore.getState().organisation?.id ?? null;
    if (!orgId) return;
    inFlight = (async () => {
      try {
        const res = await api.getBranding();
        // The org may have changed (logout / impersonation) while in flight.
        if (useAuthStore.getState().organisation?.id !== orgId) return;
        const branding = coerce(res.branding);
        saveCache(orgId, branding);
        // Not while impersonating: an L0 visit must not re-point this
        // device's sign-in page at the tenant being inspected.
        if (!useAuthStore.getState().impersonating) rememberForSignIn(branding);
        set({ branding, canEdit: res.canEdit, canWhiteLabel: res.canWhiteLabel, signIn: null });
        paint(branding);
      } catch {
        /* keep last-good cached branding */
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  loadPublic: async (pinned) => {
    if (pinned && SLUG_RE.test(pinned) && pinned !== pinnedSlug) { pinnedSlug = pinned; publicInFlight = null; }
    if (publicInFlight) return publicInFlight;
    if (useAuthStore.getState().organisation) return;
    const slug = signInSlug();
    if (!slug) {
      if (get().signIn) { set({ branding: { ...DEFAULT_BRANDING }, signIn: null }); paint(DEFAULT_BRANDING); }
      return;
    }
    publicInFlight = (async () => {
      try {
        const res = await api.getPublicBranding(slug);
        if (useAuthStore.getState().organisation) return; // signed in meanwhile
        if (res === undefined) return;                    // unreachable — keep the cache
        if (!res) {
          // The server says: no such branded tenant. Stop wearing it.
          writePublicCache(null, slug);
          try { if (localStorage.getItem(SIGNIN_SLUG_KEY) === slug) localStorage.removeItem(SIGNIN_SLUG_KEY); } catch { /* ignore */ }
          set({ branding: { ...DEFAULT_BRANDING }, signIn: null });
          paint(DEFAULT_BRANDING);
          return;
        }
        const branding = coerce(res.branding);
        const tenant: SignInTenant = { orgId: res.orgId, slug, name: res.name };
        writePublicCache({ tenant, branding }, slug);
        set({ branding, signIn: tenant });
        paint(branding);
      } finally {
        publicInFlight = null;
      }
    })();
    return publicInFlight;
  },

  adopt: (incoming) => {
    const branding = coerce(incoming);
    const orgId = useAuthStore.getState().organisation?.id ?? null;
    if (orgId) saveCache(orgId, branding);
    if (orgId && !useAuthStore.getState().impersonating) rememberForSignIn(branding);
    set({ branding });
    paint(branding);
  },

  preview: (primaryColor) => {
    applyTenantPalette(primaryColor);
    reapplyTheme();
  },

  repaint: () => paint(get().branding),
}));

// First paint from cache, after the preferences store's own boot apply.
setTimeout(() => paint(bootState.branding), 0);

// Follow the org: login, logout, and L0 impersonation all change it. Switch to
// that org's cached look immediately, then confirm with the server. On logout,
// fall back to the sign-in tenant's look rather than flashing the platform's.
let lastOrgId: string | null = bootOrgId;
useAuthStore.subscribe((state) => {
  const orgId = state.organisation?.id ?? null;
  if (orgId === lastOrgId) return;
  lastOrgId = orgId;
  inFlight = null;
  if (!orgId) {
    const out = signedOutState();
    useBrandingStore.setState({ ...out, canEdit: false, canWhiteLabel: false });
    paint(out.branding);
    void useBrandingStore.getState().loadPublic();
    return;
  }
  const branding = loadCache(orgId);
  useBrandingStore.setState({ branding, signIn: null, canEdit: false, canWhiteLabel: false });
  paint(branding);
  void useBrandingStore.getState().refresh();
});

// ── The product's name in copy ──────────────────────────────────────────────
// A white-labelled tenant's members never see the platform named: wherever the
// app would say "HVAC DesignPro" — page copy, report text, Mason's answers —
// it says the tenant's name instead. Everyone else sees the platform's name.

export const PLATFORM_PRODUCT = 'HVAC DesignPro';

function productNameFrom(s: Pick<BrandingStore, 'branding' | 'signIn'>): string {
  if (!s.branding.whiteLabel) return PLATFORM_PRODUCT;
  return s.branding.displayName
    ?? s.signIn?.name
    ?? (useAuthStore.getState().organisation?.name?.trim() || PLATFORM_PRODUCT);
}

/** Synchronous — for report generators and other non-React code. */
export function productName(): string {
  return productNameFrom(useBrandingStore.getState());
}

export function useProductName(): string {
  return useBrandingStore(productNameFrom);
}

/** The brand shown at the top of the signed-out pages: the sign-in tenant's
 *  name when there is one (white-labelled or not), else the platform's. */
export function useSignInName(): string {
  return useBrandingStore((s) => s.signIn?.name ?? PLATFORM_PRODUCT);
}

/** Rewrite platform mentions in a block of prose (Mason's knowledge base is
 *  authored with the platform's name). No-op unless white-labelled. */
export function brandText(text: string): string {
  const name = productName();
  if (name === PLATFORM_PRODUCT) return text;
  return text.replace(/HVAC Design ?Pro|\bDesignPro\b/g, name);
}

