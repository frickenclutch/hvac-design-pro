// Tenant theming — turns ONE brand colour into the app's whole accent palette.
//
// The UI's accent is Tailwind's `emerald` scale (~1,000 class usages). Tailwind
// v4 compiles every one of those to `var(--color-emerald-N)`, so re-pointing
// those eleven variables on <html> re-themes the entire signed-in app without
// touching a single component — the same mechanism `.theme-light` already uses
// for the slate scale (see index.css).
//
// The ramp matches the LUMINANCE of Tailwind's own emerald scale, shade for
// shade, and only borrows hue + saturation from the brand colour. That is
// deliberate: a tenant with a navy, violet or near-black brand would otherwise
// produce unreadable accent text on the dark shell (HSL lightness is not
// perceptual — a violet and a green at the same L differ widely in contrast).
// Matching luminance means every component keeps exactly the contrast it was
// designed with, whatever colour comes in.
//
// SECURITY: the only thing ever written into a CSS variable here is a value
// this module computed from a strictly-validated `#rrggbb`. No tenant-supplied
// string reaches the stylesheet.

const HEX_RE = /^#[0-9a-f]{6}$/;

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Shade = (typeof SHADES)[number];

/** Tailwind's emerald scale — the reference each tenant shade is matched to. */
const REFERENCE: Record<Shade, string> = {
  50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981',
  600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22',
};

export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return HEX_RE.test(s) ? s : null;
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as [number, number, number];
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** WCAG relative luminance (0–1). */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Find the HSL lightness at which (h, s) reaches `target` luminance.
 *  Luminance rises monotonically with lightness, so bisection converges. */
function rgbAtLuminance(h: number, s: number, target: number): [number, number, number] {
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(hslToRgb(h, s, mid)) < target) lo = mid; else hi = mid;
  }
  return hslToRgb(h, s, (lo + hi) / 2);
}

/** Build the 11-step palette for a brand colour. Returns null for anything
 *  that is not a strict `#rrggbb`. Pure — unit-tested. */
export function buildPalette(hexIn: unknown): Record<Shade, string> | null {
  const hex = normalizeHex(hexIn);
  if (!hex) return null;
  const [h, s] = rgbToHsl(hexToRgb(hex));
  // A grey brand stays grey; a coloured one is kept vivid enough to read as an
  // accent but capped so pale tints don't go neon.
  const sat = s < 0.08 ? s : Math.min(0.9, Math.max(0.45, s));
  const out = {} as Record<Shade, string>;
  for (const shade of SHADES) {
    out[shade] = rgbToHex(rgbAtLuminance(h, sat, luminance(hexToRgb(REFERENCE[shade]))));
  }
  return out;
}

// The space-separated RGB triple the `--accent-rgb` variable expects, for the
// active tenant colour — or null when no tenant theme is applied. The
// preferences store reads this so a personal accent never overrides a tenant's.
let activeAccentRgb: string | null = null;
export function tenantAccentRgb(): string | null {
  return activeAccentRgb;
}

/** Apply (or, with null/invalid, remove) the tenant palette on <html>. */
export function applyTenantPalette(hexIn: unknown): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const palette = buildPalette(hexIn);
  if (!palette) {
    for (const shade of SHADES) root.style.removeProperty(`--color-emerald-${shade}`);
    root.style.removeProperty('--accent-glow-rgb');
    root.style.removeProperty('--accent-glow-strong-rgb');
    activeAccentRgb = null;
    return;
  }
  for (const shade of SHADES) root.style.setProperty(`--color-emerald-${shade}`, palette[shade]);
  activeAccentRgb = hexToRgb(palette[500]).join(' ');
  root.style.setProperty('--accent-rgb', activeAccentRgb);
  root.style.setProperty('--accent-glow-rgb', hexToRgb(palette[400]).join(' '));
  root.style.setProperty('--accent-glow-strong-rgb', activeAccentRgb);
}
