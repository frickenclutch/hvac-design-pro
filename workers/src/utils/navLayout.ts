/**
 * Per-tenant navigation layout.
 *
 * A tenant admin (or L0) shapes what their members see:
 *   - sidebar : order, hide, rename, and divider placement of the main nav
 *   - landing : which nav item a member lands on after signing in
 *   - rails   : an org-default arrangement for the Settings / Team / Permits
 *               category rails, each either `user_choice` (members may
 *               re-arrange on top of the default) or `locked` (they may not)
 *
 * Storage: organisations.settings JSON under `navLayout`, alongside
 * accessPolicy / notificationPolicy / branding. Other keys are preserved.
 *
 * THIS IS PRESENTATION, NOT ACCESS CONTROL. Hiding a nav item removes a link;
 * it does not remove a capability. Every route and endpoint keeps its own
 * role / capability gate, and nothing here may ever be read as an
 * authorization decision. (Restricting what a role can DO is the access
 * policy's job — see utils/accessPolicy.ts.)
 *
 * The server does not know the frontend's nav registry, on purpose: ids are
 * validated as short slugs only, and the client ignores ids it doesn't
 * recognise and appends any it has that the layout lacks. That keeps a stored
 * layout forward- and backward-compatible across frontend releases.
 *
 * One hard rule is enforced here: the `settings` item can never be hidden,
 * because Settings is where this layout is edited — hiding it would leave the
 * tenant with no in-app way back.
 */

export type RailMode = 'user_choice' | 'locked';
export type RailName = 'settings' | 'team' | 'permits';
export const RAIL_NAMES: RailName[] = ['settings', 'team', 'permits'];

export interface SidebarItem {
  id: string;
  hidden: boolean;
  /** Tenant's own label for the item. null = the platform's label. */
  label: string | null;
  /** Draw a divider above this item (how the tenant groups the nav). */
  dividerBefore: boolean;
}

export interface RailDefault {
  /** null = the platform's own order. */
  order: string[] | null;
  hidden: string[];
  mode: RailMode;
}

export interface NavLayout {
  /** null = the platform's default sidebar. */
  sidebar: SidebarItem[] | null;
  /** Sidebar item id to land on after sign-in. null = the platform default. */
  landing: string | null;
  rails: Record<RailName, RailDefault>;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_ITEMS = 40;
export const NAV_LABEL_MAX = 24;
/** Never hideable — see header. */
export const PINNED_ID = 'settings';

const defaultRail = (): RailDefault => ({ order: null, hidden: [], mode: 'user_choice' });

export function defaultNavLayout(): NavLayout {
  return {
    sidebar: null,
    landing: null,
    rails: { settings: defaultRail(), team: defaultRail(), permits: defaultRail() },
  };
}

function parseSettings(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'string' && settings.trim()) {
    try { return JSON.parse(settings) as Record<string, unknown>; } catch { return {}; }
  }
  if (settings && typeof settings === 'object') return settings as Record<string, unknown>;
  return {};
}

const isSlug = (v: unknown): v is string => typeof v === 'string' && SLUG_RE.test(v);

function cleanLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > NAV_LABEL_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[<>\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** Unique slugs, in order, capped. Returns null when `v` is not an array. */
function slugList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (isSlug(x) && !out.includes(x)) out.push(x);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function coerceSidebar(v: unknown): SidebarItem[] | null {
  if (!Array.isArray(v)) return null;
  const out: SidebarItem[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (!isSlug(r.id) || out.some((i) => i.id === r.id)) continue;
    out.push({
      id: r.id,
      hidden: r.id === PINNED_ID ? false : r.hidden === true,
      label: cleanLabel(r.label),
      dividerBefore: r.dividerBefore === true,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out.length > 0 ? out : null;
}

function coerceRail(v: unknown): RailDefault {
  if (!v || typeof v !== 'object') return defaultRail();
  const r = v as Record<string, unknown>;
  const order = slugList(r.order);
  return {
    order: order && order.length > 0 ? order : null,
    hidden: slugList(r.hidden) ?? [],
    mode: r.mode === 'locked' ? 'locked' : 'user_choice',
  };
}

/** A landing target must be a visible sidebar item (when a sidebar is set). */
function coerceLanding(v: unknown, sidebar: SidebarItem[] | null): string | null {
  if (!isSlug(v)) return null;
  if (sidebar && sidebar.some((i) => i.id === v && i.hidden)) return null;
  return v;
}

/** Coerce any value into a fully-valid layout. Never throws; hostile or
 *  malformed input degrades to the default for that part. Used on READ as well
 *  as write, since `PUT /api/org` can write the raw settings blob. */
export function coerceNavLayout(v: unknown): NavLayout {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const rails = (r.rails && typeof r.rails === 'object' ? r.rails : {}) as Record<string, unknown>;
  const sidebar = coerceSidebar(r.sidebar);
  return {
    sidebar,
    landing: coerceLanding(r.landing, sidebar),
    rails: {
      settings: coerceRail(rails.settings),
      team: coerceRail(rails.team),
      permits: coerceRail(rails.permits),
    },
  };
}

export function resolveNavLayout(settings: unknown): NavLayout {
  return coerceNavLayout(parseSettings(settings).navLayout);
}

/** Apply a PUT body over the current layout. Top-level parts present in the
 *  body replace that part wholesale (`sidebar: null` resets it); individual
 *  rails may be sent on their own. Returns the changed part names. */
export function applyNavLayoutPatch(
  current: NavLayout,
  body: unknown,
): { next: NavLayout; changed: string[] } {
  const changed: string[] = [];
  if (!body || typeof body !== 'object') return { next: current, changed };
  const b = body as Record<string, unknown>;
  const draft: Record<string, unknown> = {
    sidebar: current.sidebar,
    landing: current.landing,
    rails: { ...current.rails },
  };
  if ('sidebar' in b) { draft.sidebar = b.sidebar; changed.push('sidebar'); }
  if ('landing' in b) { draft.landing = b.landing; changed.push('landing'); }
  if (b.rails && typeof b.rails === 'object') {
    const incoming = b.rails as Record<string, unknown>;
    for (const name of RAIL_NAMES) {
      if (name in incoming) {
        (draft.rails as Record<string, unknown>)[name] = incoming[name];
        changed.push(`rails.${name}`);
      }
    }
  }
  return { next: coerceNavLayout(draft), changed };
}

export function mergeNavLayoutIntoSettings(existingSettings: unknown, layout: NavLayout): string {
  const parsed = parseSettings(existingSettings);
  parsed.navLayout = layout;
  return JSON.stringify(parsed);
}
