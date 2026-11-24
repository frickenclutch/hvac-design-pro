import { describe, it, expect } from 'vitest';
import { buildPalette, normalizeHex, SHADES } from '../tenantTheme';

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SLATE_950 = '#020617';

describe('tenantTheme.normalizeHex', () => {
  it('accepts strict #rrggbb only', () => {
    expect(normalizeHex(' #0B5FA5 ')).toBe('#0b5fa5');
    expect(normalizeHex('#fff')).toBeNull();
    expect(normalizeHex('0b5fa5')).toBeNull();
    expect(normalizeHex('#0b5fa5;color:red')).toBeNull();
    expect(normalizeHex('url(javascript:alert(1))')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('tenantTheme.buildPalette', () => {
  it('returns null for anything that is not a strict hex', () => {
    expect(buildPalette('blue')).toBeNull();
    expect(buildPalette(undefined)).toBeNull();
  });

  it('emits all eleven shades as strict hex, light → dark', () => {
    const p = buildPalette('#0b5fa5')!;
    expect(Object.keys(p).map(Number)).toEqual([...SHADES]);
    for (const shade of SHADES) expect(p[shade]).toMatch(/^#[0-9a-f]{6}$/);
    for (let i = 1; i < SHADES.length; i++) {
      expect(luminance(p[SHADES[i]])).toBeLessThan(luminance(p[SHADES[i - 1]]));
    }
  });

  // The reason the ramp has fixed lightness: accent TEXT (-400) must stay
  // readable on the dark shell whatever brand colour a tenant picks —
  // including navy, near-black, and pure white.
  it.each(['#0b5fa5', '#001f3f', '#000000', '#ffffff', '#ff0000', '#ffe600', '#7c3aed', '#808080'])(
    'keeps -400 text at WCAG AA on slate-950 for %s',
    (hex) => {
      const p = buildPalette(hex)!;
      expect(contrast(p[400], SLATE_950)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps a grey brand grey and a coloured brand on its own hue', () => {
    const grey = buildPalette('#808080')!;
    expect(grey[500].slice(1, 3)).toBe(grey[500].slice(3, 5));
    const blue = buildPalette('#0b5fa5')!;
    const [r, , b] = [1, 3, 5].map((i) => parseInt(blue[500].slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
  });
});
