import { describe, it, expect } from 'vitest';
import {
  NAV_ITEMS,
  coerceNavLayout,
  defaultNavLayout,
  resolveSidebar,
  visibleSidebar,
  landingPath,
  effectiveRail,
  type NavLayout,
} from '../navLayout';

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const withSidebar = (sidebar: unknown, extra: Record<string, unknown> = {}): NavLayout =>
  coerceNavLayout({ sidebar, ...extra });

describe('navLayout.resolveSidebar', () => {
  it('is the registry, untouched, when the tenant has set nothing', () => {
    const rows = resolveSidebar(defaultNavLayout());
    expect(ids(rows)).toEqual(ids(NAV_ITEMS));
    expect(rows.every((r) => !r.hidden)).toBe(true);
    expect(rows.find((r) => r.id === 'team')!.dividerBefore).toBe(true);
  });

  it('applies order, labels and hiding; drops unknown ids; appends new ones', () => {
    const rows = resolveSidebar(withSidebar([
      { id: 'cad', label: 'Drafting' },
      { id: 'retired-feature' },
      { id: 'dashboard', hidden: true },
    ]));
    expect(ids(rows).slice(0, 2)).toEqual(['cad', 'dashboard']);
    expect(rows[0].label).toBe('Drafting');
    expect(rows[0].defaultLabel).toBe('CAD');
    expect(rows[1].hidden).toBe(true);
    expect(ids(rows)).not.toContain('retired-feature');
    // Every registry item still appears exactly once.
    expect([...ids(rows)].sort()).toEqual([...ids(NAV_ITEMS)].sort());
  });

  it('never hides Settings, whatever the stored layout says', () => {
    const rows = resolveSidebar(withSidebar([{ id: 'settings', hidden: true }]));
    expect(rows.find((r) => r.id === 'settings')!.hidden).toBe(false);
  });
});

describe('navLayout.visibleSidebar', () => {
  it('removes hidden and capability-gated items', () => {
    const rows = resolveSidebar(withSidebar([{ id: 'community', hidden: true }]));
    const seen = visibleSidebar(rows, { audit: false });
    expect(ids(seen)).not.toContain('community');
    expect(ids(seen)).not.toContain('audit-log');
    expect(ids(visibleSidebar(rows, { audit: true }))).toContain('audit-log');
  });

  it('keeps a group divider when the item carrying it is hidden, and never leads with one', () => {
    const hiddenTeam = visibleSidebar(resolveSidebar(withSidebar([
      { id: 'dashboard' }, { id: 'team', hidden: true, dividerBefore: true }, { id: 'community' },
    ])), { audit: false });
    expect(hiddenTeam.find((r) => r.id === 'community')!.dividerBefore).toBe(true);

    const leading = visibleSidebar(resolveSidebar(withSidebar([{ id: 'cad', dividerBefore: true }])), { audit: false });
    expect(leading[0].dividerBefore).toBe(false);
  });
});

describe('navLayout.landingPath', () => {
  it('uses the tenant choice only when this viewer can see it', () => {
    expect(landingPath(defaultNavLayout(), { audit: false })).toBe('/dashboard');
    expect(landingPath(coerceNavLayout({ landing: 'cad' }), { audit: false })).toBe('/cad');
    expect(landingPath(coerceNavLayout({ landing: 'audit-log' }), { audit: false })).toBe('/dashboard');
    expect(landingPath(coerceNavLayout({ landing: 'audit-log' }), { audit: true })).toBe('/audit-log');
    expect(landingPath(withSidebar([{ id: 'cad', hidden: true }], { landing: 'cad' }), { audit: false })).toBe('/dashboard');
    expect(landingPath(coerceNavLayout({ landing: 'no-such-page' }), { audit: false })).toBe('/dashboard');
  });
});

describe('navLayout.effectiveRail', () => {
  const org = { order: ['b', 'a'], hidden: ['c'], mode: 'user_choice' as const };

  it('locked: the tenant arrangement wins over a personal one', () => {
    expect(effectiveRail(['a', 'b'], ['x'], { ...org, mode: 'locked' }))
      .toEqual({ order: ['b', 'a'], hidden: ['c'], locked: true });
  });

  it('user_choice: tenant default until the member arranges, then theirs', () => {
    expect(effectiveRail(null, [], org)).toEqual({ order: ['b', 'a'], hidden: ['c'], locked: false });
    expect(effectiveRail(['a', 'b'], [], org)).toEqual({ order: ['a', 'b'], hidden: [], locked: false });
    expect(effectiveRail(null, ['a'], org)).toEqual({ order: null, hidden: ['a'], locked: false });
  });
});
