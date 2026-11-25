/**
 * Per-tenant branding.
 *
 * A tenant admin (or L0) gives their organisation its own look: display name,
 * tagline, one brand colour (the client derives the full palette from it), and
 * a logo. Every member of the tenant then works inside that theme.
 *
 * Storage: merged into organisations.settings JSON under `branding`, exactly
 * like accessPolicy / notificationPolicy. Other settings keys are preserved on
 * write. No migration needed.
 *
 * SECURITY — everything here is validated on READ as well as on write, because
 * `PUT /api/org` lets an admin write the raw settings blob:
 *   - primaryColor must be a strict #rrggbb hex. It is interpolated into CSS
 *     custom properties client-side; nothing but hex digits may ever reach it.
 *     There is deliberately NO free-form CSS / custom-stylesheet field.
 *   - logoKey must sit under THIS org's own `org-logos/<orgId>/` prefix. The
 *     logo is served by a public, unauthenticated route, so an unchecked key
 *     would let an admin point it at any object in the bucket (another
 *     tenant's floor plan) and exfiltrate it. The prefix check closes that.
 *   - Text fields are plain text, length-capped, no markup.
 *
 * White-label (hiding the platform's own mark entirely) is an entitlement, not
 * a preference: only L0 or an `enterprise`-plan tenant may switch it on.
 */

export interface TenantBranding {
  /** Shown in place of the platform name in the app shell. null = org name. */
  displayName: string | null;
  /** Small line under the name in the sidebar. */
  tagline: string | null;
  /** Strict `#rrggbb`. null = platform default palette. */
  primaryColor: string | null;
  /** R2 key of the logo, always under `org-logos/<orgId>/`. */
  logoKey: string | null;
  /** Hide the platform mark entirely (entitlement-gated on write). */
  whiteLabel: boolean;
}

export const DEFAULT_BRANDING: TenantBranding = {
  displayName: null,
  tagline: null,
  primaryColor: null,
  logoKey: null,
  whiteLabel: false,
};

const HEX_RE = /^#[0-9a-f]{6}$/;
const LOGO_FILE_RE = /^[A-Za-z0-9_-]{1,64}\.(png|jpg|webp)$/;

export const BRAND_NAME_MAX = 60;
export const BRAND_TAGLINE_MAX = 60;

function parseSettings(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'string' && settings.trim()) {
    try { return JSON.parse(settings) as Record<string, unknown>; } catch { return {}; }
  }
  if (settings && typeof settings === 'object') return settings as Record<string, unknown>;
  return {};
}

/** Normalise to lowercase `#rrggbb`, or null when not a strict hex colour. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return HEX_RE.test(s) ? s : null;
}

/** Plain text only: trimmed, length-capped, no angle brackets / control chars. */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  // eslint-disable-next-line no-control-regex
  if (/[<>\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

export function logoPrefix(orgId: string): string {
  return `org-logos/${orgId}/`;
}

/** True only for a logo object that belongs to `orgId`. */
export function isOwnLogoKey(key: unknown, orgId: string): key is string {
  if (typeof key !== 'string' || !orgId) return false;
  const prefix = logoPrefix(orgId);
  if (!key.startsWith(prefix)) return false;
  return LOGO_FILE_RE.test(key.slice(prefix.length));
}

/** Parse the org's settings JSON into a fully-validated branding object.
 *  Malformed / hostile stored values fall back to the default for that field —
 *  never throw, never pass an unvalidated value through. */
export function resolveBranding(settings: unknown, orgId: string): TenantBranding {
  const parsed = parseSettings(settings);
  const stored = (parsed.branding && typeof parsed.branding === 'object')
    ? parsed.branding as Record<string, unknown>
    : {};
  return {
    displayName: cleanText(stored.displayName, BRAND_NAME_MAX),
    tagline: cleanText(stored.tagline, BRAND_TAGLINE_MAX),
    primaryColor: normalizeHex(stored.primaryColor),
    logoKey: isOwnLogoKey(stored.logoKey, orgId) ? stored.logoKey : null,
    whiteLabel: stored.whiteLabel === true,
  };
}

export interface BrandingPatchResult {
  patch: Partial<Omit<TenantBranding, 'logoKey'>>;
  /** Field names that were present but invalid — surfaced as a 400. */
  invalid: string[];
}

/** Validate an incoming PUT body. `logoKey` is never client-settable — it only
 *  changes through the logo upload / delete endpoints. A field sent as `null`
 *  or `''` clears it. */
export function sanitizeBrandingPatch(body: unknown): BrandingPatchResult {
  const patch: BrandingPatchResult['patch'] = {};
  const invalid: string[] = [];
  if (!body || typeof body !== 'object') return { patch, invalid };
  const b = body as Record<string, unknown>;
  const isClear = (v: unknown) => v === null || v === '';

  if ('displayName' in b) {
    if (isClear(b.displayName)) patch.displayName = null;
    else {
      const t = cleanText(b.displayName, BRAND_NAME_MAX);
      if (t) patch.displayName = t; else invalid.push('displayName');
    }
  }
  if ('tagline' in b) {
    if (isClear(b.tagline)) patch.tagline = null;
    else {
      const t = cleanText(b.tagline, BRAND_TAGLINE_MAX);
      if (t) patch.tagline = t; else invalid.push('tagline');
    }
  }
  if ('primaryColor' in b) {
    if (isClear(b.primaryColor)) patch.primaryColor = null;
    else {
      const h = normalizeHex(b.primaryColor);
      if (h) patch.primaryColor = h; else invalid.push('primaryColor');
    }
  }
  if ('whiteLabel' in b) {
    if (typeof b.whiteLabel === 'boolean') patch.whiteLabel = b.whiteLabel;
    else invalid.push('whiteLabel');
  }
  return { patch, invalid };
}

/** White-label is an entitlement: L0, or a tenant on the enterprise plan. */
export function canWhiteLabel(plan: unknown, isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin || plan === 'enterprise';
}

/** Merge a branding object back into a settings JSON, preserving every other
 *  settings key. Returns a JSON string for the organisations.settings column. */
export function mergeBrandingIntoSettings(existingSettings: unknown, branding: TenantBranding): string {
  const parsed = parseSettings(existingSettings);
  parsed.branding = branding;
  return JSON.stringify(parsed);
}

// ── Brand colour → usable shades ────────────────────────────────────────────
// The same luminance-matched ramp the frontend uses (frontend/src/lib/
// tenantTheme.ts), reduced to the shades the server needs for emails. Kept in
// step by hand: a tenant's email accent should match its in-app accent.

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function hueSat([r, g, b]: Rgb): [number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The brand colour re-lit to the luminance of `referenceHex` (a Tailwind
 *  emerald shade). Returns `referenceHex` itself when `brandHex` is not a
 *  strict hex, so callers always get a usable colour. */
export function brandShade(brandHex: unknown, referenceHex: string): string {
  const hex = normalizeHex(brandHex);
  if (!hex) return referenceHex;
  const [h, s] = hueSat(hexToRgb(hex));
  const sat = s < 0.08 ? s : Math.min(0.9, Math.max(0.45, s));
  const target = luminance(hexToRgb(referenceHex));
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(hslToRgb(h, sat, mid)) < target) lo = mid; else hi = mid;
  }
  return rgbToHex(hslToRgb(h, sat, (lo + hi) / 2));
}

/** Emerald-400 / -500 — the platform's own email accent text and CTA fill. */
export const EMAIL_ACCENT_TEXT_REF = '#34d399';
export const EMAIL_ACCENT_FILL_REF = '#10b981';

export interface EmailBrandData {
  displayName: string;
  logoUrl: string | null;
  accentText: string;
  accentFill: string;
  whiteLabel: boolean;
}

/** Shape a tenant's branding for the email templates, or null when the tenant
 *  has set nothing (its emails then stay the platform default). `apiOrigin` is
 *  the Worker's own origin — the public logo route lives there. */
export function toEmailBrand(
  branding: TenantBranding,
  orgId: string,
  orgName: string,
  apiOrigin: string,
): EmailBrandData | null {
  if (!branding.displayName && !branding.logoKey && !branding.primaryColor) return null;
  return {
    displayName: branding.displayName ?? orgName,
    logoUrl: branding.logoKey
      ? `${apiOrigin}/org-logos/${encodeURIComponent(orgId)}?v=${encodeURIComponent(branding.logoKey)}`
      : null,
    accentText: brandShade(branding.primaryColor, EMAIL_ACCENT_TEXT_REF),
    accentFill: brandShade(branding.primaryColor, EMAIL_ACCENT_FILL_REF),
    whiteLabel: branding.whiteLabel,
  };
}

/** Load the email brand for an org. Never throws — a branding lookup must not
 *  be able to stop a password-reset or invitation email from going out. */
export async function loadEmailBrand(
  db: D1Database,
  orgId: string | null | undefined,
  apiOrigin: string,
): Promise<EmailBrandData | null> {
  if (!orgId) return null;
  try {
    const org = await db.prepare(
      `SELECT name, settings FROM organisations WHERE id = ?`
    ).bind(orgId).first();
    if (!org) return null;
    return toEmailBrand(resolveBranding(org.settings, orgId), orgId, String(org.name ?? ''), apiOrigin);
  } catch {
    return null;
  }
}
