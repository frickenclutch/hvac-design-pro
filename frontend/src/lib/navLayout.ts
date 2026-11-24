// Tenant navigation layout — pure logic shared by the app shell, the three
// category rails, and the admin editor. The SERVER stores and validates the
// layout (workers/src/utils/navLayout.ts); this file is the frontend's nav
// registry plus the functions that lay a tenant's choices over it.
//
// PRESENTATION ONLY. Hiding an item removes a link, never a capability — every
// route keeps its own gate. Do not read anything here as an access decision.
//
// Forward-compatibility rule (same as every arrange rail in the app): ids the
// layout names that this build doesn't have are ignored; items this build has
// that the layout doesn't name are appended in registry order. A tenant's
// saved layout therefore never hides a feature shipped after they saved it.

export type RailMode = 'user_choice' | 'locked';
export type RailName = 'settings' | 'team' | 'permits';
export const RAIL_NAMES: RailName[] = ['settings', 'team', 'permits'];

export interface SidebarItemLayout {
  id: string;
  hidden: boolean;
  label: string | null;
  dividerBefore: boolean;
}

export interface RailDefault {
  order: string[] | null;
  hidden: string[];
  mode: RailMode;
}

export interface NavLayout {
  sidebar: SidebarItemLayout[] | null;
  landing: string | null;
  rails: Record<RailName, RailDefault>;
}

export const NAV_LABEL_MAX = 24;
/** Settings hosts the layout editor, so it can never be hidden. */
export const PINNED_NAV_ID = 'settings';
export const DEFAULT_LANDING_PATH = '/dashboard';

/** The main-navigation registry — the platform's default sidebar. */
export interface NavItemDef {
  id: string;
  to: string;
  label: string;
  /** Platform default grouping: a divider is drawn above this item. */
  dividerBefore?: boolean;
  /** Only shown to viewers holding this capability. */
  requires?: 'audit';
}

export const NAV_ITEMS: NavItemDef[] = [
  { id: 'dashboard', to: '/dashboard', label: 'Projects' },
  { id: 'calculator', to: '/calculator', label: 'Manual J' },
  { id: 'manual-d', to: '/manual-d', label: 'Manual D' },
  { id: 'aed', to: '/aed', label: 'AED' },
  { id: 'manual-s', to: '/manual-s', label: 'Manual S' },
  { id: 'reports', to: '/reports', label: 'Reports' },
  { id: 'cad', to: '/cad', label: 'CAD' },
  { id: 'team', to: '/team', label: 'Team', dividerBefore: true },
  { id: 'community', to: '/community', label: 'Community' },
  { id: 'permits', to: '/permits', label: 'Permits' },
  { id: 'audit-log', to: '/audit-log', label: 'Audit log', requires: 'audit' },
  { id: 'settings', to: '/settings', label: 'Settings' },
  { id: 'guide', to: '/guide', label: 'Guide' },
];

const defaultRail = (): RailDefault => ({ order: null, hidden: [], mode: 'user_choice' });

export function defaultNavLayout(): NavLayout {
  return {
    sidebar: null,
    landing: null,
    rails: { settings: defaultRail(), team: defaultRail(), permits: defaultRail() },
  };
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isSlug = (v: unknown): v is string => typeof v === 'string' && SLUG_RE.test(v);

function slugList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (isSlug(x) && !out.includes(x)) out.push(x);
  return out;
}

function coerceRail(v: unknown): RailDefault {
  if (!v || typeof v !== 'object') return defaultRail();
  const r = v as Record<string, unknown>;
  const order = slugList(r.order);
  return { order: order.length > 0 ? order : null, hidden: slugList(r.hidden), mode: r.mode === 'locked' ? 'locked' : 'user_choice' };
}

/** Coerce a server payload or a localStorage cache into a valid layout. The
 *  cache is user-writable storage, so it gets the same distrust as the wire. */
export function coerceNavLayout(v: unknown): NavLayout {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const rails = (r.rails && typeof r.rails === 'object' ? r.rails : {}) as Record<string, unknown>;
  let sidebar: SidebarItemLayout[] | null = null;
  if (Array.isArray(r.sidebar)) {
    const items: SidebarItemLayout[] = [];
    for (const raw of r.sidebar) {
      if (!raw || typeof raw !== 'object') continue;
      const i = raw as Record<string, unknown>;
      if (!isSlug(i.id) || items.some((x) => x.id === i.id)) continue;
      const label = typeof i.label === 'string' && i.label.trim() && i.label.length <= NAV_LABEL_MAX ? i.label.trim() : null;
      items.push({ id: i.id, hidden: i.id === PINNED_NAV_ID ? false : i.hidden === true, label, dividerBefore: i.dividerBefore === true });
    }
    sidebar = items.length > 0 ? items : null;
  }
  return {
    sidebar,
    landing: isSlug(r.landing) ? r.landing : null,
    rails: { settings: coerceRail(rails.settings), team: coerceRail(rails.team), permits: coerceRail(rails.permits) },
  };
}

/** One row of the resolved sidebar. */
export interface ResolvedNavItem {
  id: string;
  to: string;
  label: string;
  defaultLabel: string;
  hidden: boolean;
  dividerBefore: boolean;
  requires?: 'audit';
}

/** Lay the tenant's sidebar over the registry: every registry item appears
 *  exactly once, in the tenant's order, unknown ids dropped, new ones appended. */
export function resolveSidebar(layout: NavLayout, registry: NavItemDef[] = NAV_ITEMS): ResolvedNavItem[] {
  const toRow = (def: NavItemDef, l?: SidebarItemLayout): ResolvedNavItem => ({
    id: def.id,
    to: def.to,
    label: l?.label ?? def.label,
    defaultLabel: def.label,
    hidden: def.id === PINNED_NAV_ID ? false : !!l?.hidden,
    dividerBefore: l ? l.dividerBefore : !!def.dividerBefore,
    requires: def.requires,
  });
  if (!layout.sidebar) return registry.map((d) => toRow(d));
  const byId = new Map(registry.map((d) => [d.id, d]));
  const named = layout.sidebar.flatMap((l) => {
    const def = byId.get(l.id);
    return def ? [toRow(def, l)] : [];
  });
  const missing = registry.filter((d) => !layout.sidebar!.some((l) => l.id === d.id)).map((d) => toRow(d));
  return [...named, ...missing];
}

/** What a given viewer actually sees: hidden and capability-gated items out,
 *  and no divider left dangling at the very top. */
export function visibleSidebar(rows: ResolvedNavItem[], caps: { audit: boolean }): ResolvedNavItem[] {
  const out: ResolvedNavItem[] = [];
  let pendingDivider = false;
  for (const row of rows) {
    // A divider belongs to the group boundary, not the item — carry it forward
    // past items this viewer doesn't see so the grouping survives.
    if (row.dividerBefore) pendingDivider = true;
    if (row.hidden || (row.requires === 'audit' && !caps.audit)) continue;
    out.push({ ...row, dividerBefore: pendingDivider && out.length > 0 });
    pendingDivider = false;
  }
  return out;
}

/** Where a viewer lands after sign-in: the tenant's choice when it is an item
 *  this viewer can see, otherwise the platform default. */
export function landingPath(layout: NavLayout, caps: { audit: boolean }): string {
  if (!layout.landing) return DEFAULT_LANDING_PATH;
  const hit = visibleSidebar(resolveSidebar(layout), caps).find((r) => r.id === layout.landing);
  return hit ? hit.to : DEFAULT_LANDING_PATH;
}

export interface EffectiveRail {
  order: string[] | null;
  hidden: string[];
  /** True when the tenant has locked this rail — the arrange control is off. */
  locked: boolean;
}

/** Combine a member's personal rail arrangement with the tenant default.
 *   locked      → the tenant's arrangement, full stop.
 *   user_choice → the member's own once they have arranged anything;
 *                 until then, the tenant default. */
export function effectiveRail(
  personalOrder: string[] | null,
  personalHidden: string[],
  rail: RailDefault,
): EffectiveRail {
  if (rail.mode === 'locked') return { order: rail.order, hidden: rail.hidden, locked: true };
  const customised = personalOrder !== null || personalHidden.length > 0;
  return customised
    ? { order: personalOrder, hidden: personalHidden, locked: false }
    : { order: rail.order, hidden: rail.hidden, locked: false };
}
