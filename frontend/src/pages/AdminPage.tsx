/**
 * Platform Admin — test harness + control panel.
 *
 * Visible only to L0 platform_admin users. Deliberately utilitarian: this
 * is the operator's instrument, not the eventual polished admin UI. Every
 * future facet (Unit 3+) gets a clickable test panel here as it ships, so
 * we never lose the ability to exercise an endpoint without curl/devtools.
 *
 * Sections:
 *  - Metrics: org / user / project / signup totals + last-30d activity
 *  - Organisations: full table with drill-down panel (incl. read-only
 *    "View as tenant" impersonation — 30-min access-only session)
 *  - Audit: recent cross-org events
 *  - Action Lab: all planned units shipped — now a where-things-live index;
 *    future endpoint smoke-test buttons land here again as needed
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  ShieldCheck, Activity, Building2, Users, FlaskConical, ChevronRight,
  RefreshCw, Cloud, AlertTriangle, Search, Eye, EyeOff,
  CheckCircle2, Gauge, Database, BadgeCheck, Trash2,
  X, ArrowUpDown, Check, GripVertical, Minus, Plus, RotateCcw, Clock,
} from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { usePreferencesStore, type UserPreferences } from '../stores/usePreferencesStore';
import { api } from '../lib/api';
import AuditLogView from '../components/AuditLogView';

type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; message: string };

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: 'idle' });
  const run = () => {
    setState({ status: 'loading' });
    fn()
      .then((data) => setState({ status: 'ok', data }))
      .catch((err: Error) => setState({ status: 'error', message: err.message }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);
  return [state, run];
}

// ── Global refresh coordination ──────────────────────────────────────────────
// One tick shared by every live (telemetry-fetching) section. The manual
// Refresh button and the auto-interval both bump it; each live section lists
// the tick in its `useLoad` deps, so a bump refetches whatever category is on
// screen. Static categories (Action lab) ignore it. This is the admin-specific
// counterpart to the Settings "workbench persists" controls.
const AdminRefreshContext = createContext(0);
const useRefreshTick = () => useContext(AdminRefreshContext);

const REFRESH_OPTIONS: { label: string; ms: number }[] = [
  { label: 'Manual', ms: 0 },
  { label: '10s', ms: 10_000 },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
];

// ── Registry — single source of truth for the admin rail / detail ────────────
interface AdminCategory {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  keywords: string[];
  /** true = pulls live telemetry (subscribes to the refresh tick). */
  live: boolean;
  node: React.ReactNode;
}

function buildAdminCategories(): AdminCategory[] {
  return [
    { id: 'metrics', title: 'Metrics', subtitle: 'Cross-tenant totals + 30-day activity', icon: <Activity className="w-4 h-4" />, live: true,
      keywords: ['metrics', 'totals', 'organisations', 'users', 'projects', 'calculations', 'signups', 'plans', 'org types', 'active'], node: <MetricsSection /> },
    { id: 'qa', title: 'Q/A Benchmarks', subtitle: 'Engine integrity · calc telemetry · cutover', icon: <BadgeCheck className="w-4 h-4" />, live: true,
      keywords: ['qa', 'benchmark', 'certification', 'acca', 'drift', 'shadow', 'cutover', 'readiness', 'reliability', 'p95', 'duration', 'engine version', 'telemetry'], node: <QaBenchmarksSection /> },
    { id: 'orgs', title: 'Organisations', subtitle: 'Every tenant — drill in for members + actions', icon: <Building2 className="w-4 h-4" />, live: true,
      keywords: ['organisations', 'organizations', 'tenants', 'orgs', 'members', 'roles', 'impersonate', 'billing', 'plan', 'remove'], node: <OrgsSection /> },
    { id: 'audit', title: 'Audit Log', subtitle: 'Every mutation across every tenant', icon: <Activity className="w-4 h-4" />, live: true,
      keywords: ['audit', 'log', 'events', 'history', 'mutations', 'diff', 'before', 'after'], node: <AuditSection /> },
    { id: 'action-lab', title: 'Action Lab', subtitle: 'Operator tools + where each unit lives', icon: <FlaskConical className="w-4 h-4" />, live: false,
      keywords: ['action', 'lab', 'tools', 'smoke test', 'endpoint', 'shipped', 'where', 'jump'], node: <ActionLabSection /> },
  ];
}

export default function AdminPage() {
  const user = useAuthStore((s) => s.user);
  const lastCategory = usePreferencesStore((s) => s.adminLastCategory);
  const navOrder = usePreferencesStore((s) => s.adminNavOrder);
  const navHidden = usePreferencesStore((s) => s.adminNavHidden);
  const autoMs = usePreferencesStore((s) => s.adminAutoRefreshMs);
  const updatePrefs = usePreferencesStore((s) => s.update);

  // Global refresh tick — the manual button and the auto-interval both bump it.
  const [tick, setTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => Date.now());
  const [spinning, setSpinning] = useState(false);
  const bump = useCallback(() => {
    setTick((t) => t + 1);
    setLastRefreshedAt(Date.now());
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 700);
  }, []);
  useEffect(() => {
    if (!autoMs) return;
    const id = window.setInterval(bump, autoMs);
    return () => window.clearInterval(id);
  }, [autoMs, bump]);

  // Registry → custom order (forward-compatible: newer categories append) →
  // rail set (minus hidden). Same contract as the Settings rail.
  const baseCategories = useMemo(() => buildAdminCategories(), []);
  const categories = useMemo(() => {
    if (!navOrder) return baseCategories;
    const byId = new Map(baseCategories.map((c) => [c.id, c]));
    const known = navOrder.map((id) => byId.get(id)).filter((c): c is AdminCategory => !!c);
    const missing = baseCategories.filter((c) => !navOrder.includes(c.id));
    return [...known, ...missing];
  }, [baseCategories, navOrder]);
  const railCategories = useMemo(
    () => categories.filter((c) => !navHidden.includes(c.id)),
    [categories, navHidden],
  );

  const [active, setActive] = useState<string>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return hash || lastCategory || '';
  });
  const [query, setQuery] = useState('');
  const [arrangeMode, setArrangeMode] = useState(false);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  // Search filters the rail itself (categories are coarse and few; each detail
  // is a heavy live panel, so we never mount more than one at a time).
  const matches = useMemo(() => {
    if (!searching) return railCategories;
    return railCategories.filter((c) =>
      `${c.title} ${c.subtitle} ${c.keywords.join(' ')}`.toLowerCase().includes(q));
  }, [searching, q, railCategories]);

  // Active resolves against the full ordered set (so a deep-linked / last-open
  // hidden category still renders); a fresh visit or a no-match search falls
  // back to the first shown/matching category.
  const pool = searching ? matches : categories;
  const activeCat = pool.find((c) => c.id === active)
    ?? (searching ? matches[0] : railCategories[0])
    ?? categories[0];
  useEffect(() => {
    if (activeCat && activeCat.id !== active) setActive(activeCat.id);
  }, [activeCat, active]);

  // Deep-links / in-page hash jumps (Action lab "jump to" links, back/forward).
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '');
      if (h) { setActive(h); setQuery(''); usePreferencesStore.getState().update({ adminLastCategory: h }); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const selectCategory = (id: string) => {
    setActive(id);
    updatePrefs({ adminLastCategory: id });
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${id}`);
  };
  const pickCategory = (id: string) => { setQuery(''); selectCategory(id); };

  // Gate — after all hooks so hook order stays stable. Server still enforces 403.
  if (!user) return <Navigate to="/" replace />;
  if (!user.isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AdminRefreshContext.Provider value={tick}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
          {/* Hero — echoes the Settings portal plate in the L0 amber identity,
              with the global refresh control docked on the right. */}
          <header className="mb-8">
            <div className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-slate-900/60 to-slate-950 p-5 sm:p-6 shadow-[0_16px_50px_rgba(0,0,0,0.6)]">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-7 h-7 text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-amber-400/80">Platform · L0</p>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">Platform Admin</h1>
                    <p className="text-xs sm:text-sm text-slate-400 truncate">
                      Signed in as <span className="text-amber-300 font-mono">{user.email}</span>
                    </p>
                  </div>
                </div>
                <RefreshControl
                  intervalMs={autoMs}
                  onIntervalChange={(ms) => updatePrefs({ adminAutoRefreshMs: ms })}
                  onRefresh={bump}
                  lastRefreshedAt={lastRefreshedAt}
                  spinning={spinning}
                />
              </div>
            </div>
          </header>

          <div className="flex flex-col md:flex-row gap-6">
            {/* Search + category rail — registry-driven, arrange/hide like Settings.
                Horizontal-scroll on mobile, sticky vertical list on desktop. */}
            <nav className="md:w-56 md:shrink-0 md:sticky md:top-4 self-start w-full" aria-label="Admin sections">
              {!arrangeMode && (
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search admin…"
                    aria-label="Search admin sections"
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl pl-9 pr-8 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 min-h-[44px]"
                  />
                  {query && (
                    <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1.5 mb-3">
                <button
                  onClick={() => { setArrangeMode((v) => !v); setQuery(''); }}
                  aria-pressed={arrangeMode}
                  title={arrangeMode ? 'Done arranging' : 'Arrange sections — drag to reorder, hide what you don’t use'}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors min-h-[36px] ${arrangeMode ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'}`}
                >
                  {arrangeMode ? <Check className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3.5 h-3.5" />}
                  {arrangeMode ? 'Done' : 'Arrange'}
                </button>
              </div>

              {arrangeMode ? (
                <AdminArrangeRail
                  categories={categories}
                  hidden={navHidden}
                  defaultOrder={baseCategories.map((c) => c.id)}
                  onChange={updatePrefs}
                />
              ) : (
                <AdminRail categories={matches} active={activeCat?.id ?? ''} onSelect={pickCategory} />
              )}
            </nav>

            {/* Detail — one category at a time (keyed so switching remounts and
                refetches). While arranging, an instructional card instead. */}
            <div className="flex-1 min-w-0">
              {arrangeMode ? (
                <AdminArrangeHint />
              ) : matches.length === 0 ? (
                <p className="text-sm text-slate-500 py-10 text-center">No admin sections match “{query}”.</p>
              ) : activeCat ? (
                <div key={activeCat.id}>{activeCat.node}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </AdminRefreshContext.Provider>
  );
}

// ── Refresh control ──────────────────────────────────────────────────────────
function RefreshControl({
  intervalMs, onIntervalChange, onRefresh, lastRefreshedAt, spinning,
}: {
  intervalMs: number;
  onIntervalChange: (ms: number) => void;
  onRefresh: () => void;
  lastRefreshedAt: number;
  spinning: boolean;
}) {
  // Live "updated Ns ago" — re-render once a second so the label stays honest.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.round((Date.now() - lastRefreshedAt) / 1000));
  const ago = secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ${secs % 60}s ago`;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-slate-500" title="When the monitored panels last pulled fresh data">
        <Clock className="w-3 h-3" /> updated {ago}
      </span>
      <div className="flex items-center rounded-xl border border-slate-700/60 bg-slate-900/60 overflow-hidden">
        <label className="flex items-center gap-1.5 pl-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <RefreshCw className="w-3 h-3" /> Auto
          <select
            value={intervalMs}
            onChange={(e) => onIntervalChange(Number(e.target.value))}
            className="bg-transparent text-slate-200 text-xs font-semibold py-1.5 pr-1 focus:outline-none cursor-pointer"
            aria-label="Auto-refresh interval"
            title="Auto-refresh interval for the monitored panels"
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.ms} value={o.ms} className="bg-slate-900">{o.label}</option>
            ))}
          </select>
        </label>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-300 bg-amber-500/10 hover:bg-amber-500/25 border-l border-slate-700/60 transition-colors min-h-[40px]"
          title="Refresh the monitored panels now"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </div>
  );
}

// ── Rail (mirrors SettingsRail; amber active accent) ─────────────────────────
function AdminRail({ categories, active, onSelect }: { categories: AdminCategory[]; active: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-1 px-1 md:mx-0 md:px-0">
      {categories.map((c) => {
        const isActive = c.id === active;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all min-h-[44px] whitespace-nowrap ${isActive ? 'bg-slate-800/80 text-white border border-slate-700/60 shadow-inner' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'}`}
          >
            <span className={isActive ? 'text-amber-400' : 'text-slate-500'}>{c.icon}</span>
            {c.title}
          </button>
        );
      })}
    </div>
  );
}

// ── Arrange mode (mirrors SettingsArrangeRail; adminNav* prefs) ──────────────
function AdminArrangeRail({ categories, hidden, defaultOrder, onChange }: {
  categories: AdminCategory[];
  hidden: string[];
  defaultOrder: string[];
  onChange: (patch: Partial<UserPreferences>) => void;
}) {
  const meta = new Map(categories.map((c) => [c.id, c]));
  const ids = categories.map((c) => c.id);
  const visibleIds = ids.filter((id) => !hidden.includes(id));
  const hiddenIds = ids.filter((id) => hidden.includes(id));

  const [dragId, setDragId] = useState<string | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const liveOrderRef = useRef<string[] | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragInfo = useRef<{ id: string; startY: number; startIndex: number; rowH: number; order: string[] } | null>(null);

  const renderIds = liveOrder ?? visibleIds;

  const commit = (finalVisible: string[]) => {
    const full = [...finalVisible, ...hiddenIds];
    const isDefault = full.length === defaultOrder.length && full.every((x, i) => x === defaultOrder[i]);
    onChange({ adminNavOrder: isDefault ? null : full });
  };

  const onDragStart = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const order = [...renderIds];
    const el = itemRefs.current[id];
    const rowH = Math.max(20, el ? el.getBoundingClientRect().height + 4 : 48);
    dragInfo.current = { id, startY: e.clientY, startIndex: order.indexOf(id), rowH, order };
    setDragId(id);
    liveOrderRef.current = order;
    setLiveOrder(order);

    const onMove = (me: PointerEvent) => {
      const d = dragInfo.current;
      if (!d) return;
      const delta = Math.round((me.clientY - d.startY) / d.rowH);
      const target = Math.max(0, Math.min(d.order.length - 1, d.startIndex + delta));
      const next = d.order.filter((x) => x !== d.id);
      next.splice(target, 0, d.id);
      liveOrderRef.current = next;
      setLiveOrder(next);
    };
    const onUp = () => {
      const d = dragInfo.current;
      dragInfo.current = null;
      const final = liveOrderRef.current ?? (d ? d.order : null);
      setDragId(null);
      setLiveOrder(null);
      liveOrderRef.current = null;
      if (final) commit(final);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const hideCat = (id: string) => onChange({ adminNavHidden: [...hidden.filter((h) => h !== id), id] });
  const restoreCat = (id: string) => onChange({ adminNavHidden: hidden.filter((h) => h !== id) });
  const reset = () => onChange({ adminNavOrder: null, adminNavHidden: [] });

  return (
    <div className="flex flex-col gap-1">
      {renderIds.map((id) => {
        const c = meta.get(id);
        if (!c) return null;
        return (
          <div
            key={id}
            ref={(el) => { itemRefs.current[id] = el; }}
            onPointerDown={(e) => onDragStart(e, id)}
            className={`relative flex items-center gap-2 px-2.5 py-2.5 rounded-xl text-sm font-semibold cursor-grab active:cursor-grabbing transition-shadow min-h-[44px] ${dragId === id ? 'ring-2 ring-amber-400/70 bg-slate-800/80 z-10' : 'ring-1 ring-slate-700/60 hover:ring-slate-500/70 bg-slate-900/40'}`}
          >
            <GripVertical className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span className="text-slate-500 shrink-0">{c.icon}</span>
            <span className="text-slate-200 truncate">{c.title}</span>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); hideCat(id); }}
              title={`Hide ${c.title} from the rail`}
              aria-label={`Hide ${c.title} from the rail`}
              className="ml-auto shrink-0 w-6 h-6 rounded-full bg-slate-800 border border-slate-600 text-slate-400 hover:text-red-300 hover:border-red-400/70 flex items-center justify-center transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
          </div>
        );
      })}

      {hiddenIds.length > 0 && (
        <>
          <div className="mt-2 mb-0.5 px-1 text-[9px] font-mono font-bold uppercase tracking-widest text-slate-600 select-none">Hidden</div>
          {hiddenIds.map((id) => {
            const c = meta.get(id);
            if (!c) return null;
            return (
              <div key={id} className="relative flex items-center gap-2 px-2.5 py-2 rounded-xl ring-1 ring-slate-800/80 bg-slate-900/30 opacity-60 hover:opacity-90 transition-opacity min-h-[40px]">
                <span className="text-slate-600 shrink-0">{c.icon}</span>
                <span className="text-slate-400 truncate text-sm">{c.title}</span>
                <button
                  onClick={() => restoreCat(id)}
                  title={`Show ${c.title} in the rail`}
                  aria-label={`Show ${c.title} in the rail`}
                  className="ml-auto shrink-0 w-6 h-6 rounded-full bg-slate-800 border border-slate-600 text-slate-400 hover:text-emerald-300 hover:border-emerald-400/70 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </>
      )}

      <button
        onClick={reset}
        title="Reset to the default order with every section shown"
        className="mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-amber-300 hover:bg-slate-800/60 transition-colors min-h-[36px]"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Reset order
      </button>
    </div>
  );
}

function AdminArrangeHint() {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6 text-sm text-slate-400 leading-relaxed">
      <div className="flex items-center gap-2 mb-2 text-slate-200 font-semibold">
        <ArrowUpDown className="w-4 h-4 text-amber-400" /> Arranging sections
      </div>
      <p>
        Drag the rows on the left to reorder your admin sections. Use the
        <span className="inline-flex items-center justify-center align-middle mx-1 w-4 h-4 rounded-full bg-slate-800 border border-slate-600"><Minus className="w-2.5 h-2.5" /></span>
        on a row to hide a section from the rail — it stays reachable from search.
        Click <span className="text-amber-300 font-semibold">Done</span> when you're finished; your layout saves to this workbench.
      </p>
    </div>
  );
}

// ── Metrics ──────────────────────────────────────────────────────────────────
function MetricsSection() {
  const tick = useRefreshTick();
  const [state] = useLoad(() => api.platformMetrics(), [tick]);

  return (
    <SectionShell
      icon={<Activity className="w-4 h-4" />}
      title="Platform metrics"
      subtitle="Cross-tenant totals + last-30-day activity"
      loading={state.status === 'loading'}
    >
      {state.status === 'error' && <ErrorBlock message={state.message} />}
      {state.status === 'ok' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Organisations" value={state.data.totals.org_count} />
            <Stat label="Users" value={state.data.totals.user_count} hint={`${state.data.totals.verified_user_count} verified`} />
            <Stat label="Projects" value={state.data.totals.project_count} hint={`${state.data.recent.projects_30d} new in 30d`} />
            <Stat label="Calculations" value={state.data.totals.calculation_count} hint={`${state.data.recent.calculations_30d} in 30d`} />
            <Stat label="CAD drawings" value={state.data.totals.drawing_count} />
            <Stat label="Signups (30d)" value={state.data.recent.signups_30d} />
            <Stat label="Active users (7d)" value={state.data.recent.active_users_7d} />
            <Stat label="Paid orgs" value={state.data.totals.org_paid} hint={`${state.data.totals.org_free_beta} free beta`} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
            <BreakdownTable title="Org types" rows={state.data.breakdown.orgTypes.map((r) => [r.org_type, r.count])} />
            <BreakdownTable title="Plan tiers" rows={state.data.breakdown.planTiers.map((r) => [r.plan, r.count])} />
          </div>
          <RawJsonDrawer payload={state.data} />
        </>
      )}
    </SectionShell>
  );
}

// ── Q/A Benchmarks ───────────────────────────────────────────────────────────
// Cross-tenant quality + accuracy + throughput scoreboard. Read-only —
// surfaces the data the L0 admin needs to answer "is the platform sound?"
// without curl-ing endpoints. Static cert facts join with live D1 telemetry.
function QaBenchmarksSection() {
  const tick = useRefreshTick();
  const [state] = useLoad(() => api.platformQaBenchmarks(), [tick]);

  return (
    <SectionShell
      icon={<BadgeCheck className="w-4 h-4" />}
      title="Q/A benchmarks"
      subtitle="Engine integrity · calc telemetry · audit activity"
      loading={state.status === 'loading'}
    >
      {state.status === 'error' && <ErrorBlock message={state.message} />}
      {state.status === 'ok' && (
        <>
          <CertificationCard cert={state.data.certification} />
          <CalcTelemetryCards
            volume={state.data.calcVolume}
            duration={state.data.calcDuration}
            audit={state.data.auditVolume}
          />
          <ShadowRunDriftCard
            drift={state.data.shadowRunDrift}
            reliability={state.data.shadowRunReliability}
          />
          <CutoverReadinessPanel
            drift={state.data.shadowRunDrift}
            reliability={state.data.shadowRunReliability}
            failureCauses={state.data.shadowRunFailureCauses}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <BreakdownTable
              title="Calc-type mix (all-time)"
              rows={state.data.calcMix.map((r) => [r.calc_type, r.count])}
            />
            <EngineVersionTable rows={state.data.engineVersions} />
          </div>
          <RawJsonDrawer payload={state.data} />
        </>
      )}
    </SectionShell>
  );
}

// Phase 1 shadow-run drift aggregate — surfaces the cross-user data
// that was previously only console-visible. Drives the Phase 2 trigger
// criteria from docs/option-e-ui-migration-plan.md (≤ 5% drift on real
// projects). Reliability tile shows shadow-run success vs failure rate
// — high failure means the construction registry needs more variants.
function ShadowRunDriftCard({
  drift, reliability,
}: {
  drift: {
    sample_size: number | null;
    avg_abs_heat_pct: number | null;
    avg_abs_sens_pct: number | null;
    avg_abs_latent_pct: number | null;
    max_abs_heat_pct: number | null;
    max_abs_sens_pct: number | null;
    max_abs_latent_pct: number | null;
  } | null;
  reliability: { shadow_success: number | null; shadow_failure: number | null } | null;
}) {
  const sample = drift?.sample_size ?? 0;
  const succ = reliability?.shadow_success ?? 0;
  const fail = reliability?.shadow_failure ?? 0;
  const total = succ + fail;
  const successRate = total > 0 ? (succ / total) * 100 : 0;
  const fmtPct = (v: number | null | undefined) =>
    v == null ? '—' : `${v.toFixed(2)}%`;

  // Phase 2 trigger threshold from docs/option-e-ui-migration-plan.md
  const PHASE_2_DRIFT_TARGET = 5.0;
  const meets = (v: number | null | undefined) =>
    v != null && Math.abs(v) <= PHASE_2_DRIFT_TARGET;

  return (
    <div className="rounded-xl border border-slate-800/40 bg-slate-900/40 p-4 mt-3">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BadgeCheck className="w-4 h-4 text-amber-400" />
          <h3 className="font-bold text-white text-sm">Phase 1 shadow-run drift (last 30 d)</h3>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          n = {sample}  ·  Phase 2 target: |drift| ≤ {PHASE_2_DRIFT_TARGET}%
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div className="rounded-lg bg-slate-950/50 border border-slate-800/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Heat avg drift</div>
          <div className={`font-bold tabular-nums text-base mt-0.5 ${meets(drift?.avg_abs_heat_pct) ? 'text-emerald-400' : drift?.avg_abs_heat_pct != null ? 'text-amber-400' : 'text-slate-500'}`}>
            {fmtPct(drift?.avg_abs_heat_pct)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
            max {fmtPct(drift?.max_abs_heat_pct)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-950/50 border border-slate-800/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Sens avg drift</div>
          <div className={`font-bold tabular-nums text-base mt-0.5 ${meets(drift?.avg_abs_sens_pct) ? 'text-emerald-400' : drift?.avg_abs_sens_pct != null ? 'text-amber-400' : 'text-slate-500'}`}>
            {fmtPct(drift?.avg_abs_sens_pct)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
            max {fmtPct(drift?.max_abs_sens_pct)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-950/50 border border-slate-800/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Latent avg drift</div>
          <div className={`font-bold tabular-nums text-base mt-0.5 ${meets(drift?.avg_abs_latent_pct) ? 'text-emerald-400' : drift?.avg_abs_latent_pct != null ? 'text-amber-400' : 'text-slate-500'}`}>
            {fmtPct(drift?.avg_abs_latent_pct)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
            max {fmtPct(drift?.max_abs_latent_pct)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-950/50 border border-slate-800/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Shadow reliability</div>
          <div className={`font-bold tabular-nums text-base mt-0.5 ${successRate >= 95 ? 'text-emerald-400' : total > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
            {total > 0 ? `${successRate.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
            {succ} ok · {fail} fail
          </div>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Drift = (cert-grade − legacy) / legacy, taken on every Manual J calc that ran the shadow engine successfully. Failures (engine throws on unmapped construction) accrue separately under reliability — high failure rate indicates the registry needs more variants.
      </p>
    </div>
  );
}

// Cutover Readiness — the single "are we ready to flip the cert engine from
// shadow-run to the displayed result?" verdict. Phase-2 cutover unblocks
// revenue-eligible permit sales, so this rolls the three independent gates
// into one glance:
//   1. n_projects ≥ 10 distinct projects (NOT rows — see backend query)
//   2. max |drift| ≤ 5% across heat / sens / latent
//   3. shadow reliability ≥ 95% (engine doesn't throw on real production runs)
// Plus the throwing-cause breakdown so a NOT-READY verdict names the concrete
// blocker (e.g. the known ceiling-CTD bin) instead of a bare failure count.
const READINESS_MIN_PROJECTS = 10;
const READINESS_MAX_DRIFT_PCT = 5.0;
const READINESS_MIN_RELIABILITY_PCT = 95;

function CutoverReadinessPanel({
  drift, reliability, failureCauses,
}: {
  drift: {
    sample_size: number | null;
    n_projects: number | null;
    max_abs_heat_pct: number | null;
    max_abs_sens_pct: number | null;
    max_abs_latent_pct: number | null;
  } | null;
  reliability: { shadow_success: number | null; shadow_failure: number | null } | null;
  failureCauses: Array<{ cause: string; count: number; n_projects: number }> | null;
}) {
  const nProjects = drift?.n_projects ?? 0;

  // Worst (largest) abs drift across the three load components. Nulls mean
  // "no successful shadow data yet" — treat as not-yet-evaluable, not 0%.
  const driftValues = [
    drift?.max_abs_heat_pct,
    drift?.max_abs_sens_pct,
    drift?.max_abs_latent_pct,
  ].filter((v): v is number => v != null);
  const maxDrift = driftValues.length > 0 ? Math.max(...driftValues.map(Math.abs)) : null;

  const succ = reliability?.shadow_success ?? 0;
  const fail = reliability?.shadow_failure ?? 0;
  const totalRuns = succ + fail;
  const reliabilityPct = totalRuns > 0 ? (succ / totalRuns) * 100 : null;

  // Each gate: pass only when we have data AND it clears the bar. No data ⇒
  // not passing (you can't certify readiness on zero evidence).
  const projectsPass = nProjects >= READINESS_MIN_PROJECTS;
  const driftPass = maxDrift != null && maxDrift <= READINESS_MAX_DRIFT_PCT;
  const reliabilityPass =
    reliabilityPct != null && reliabilityPct >= READINESS_MIN_RELIABILITY_PCT;
  const ready = projectsPass && driftPass && reliabilityPass;

  const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);
  const causes = failureCauses ?? [];

  return (
    <div
      className={`rounded-xl border p-4 mt-3 ${
        ready
          ? 'border-emerald-500/40 bg-emerald-500/[0.04]'
          : 'border-amber-500/40 bg-amber-500/[0.04]'
      }`}
    >
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {ready ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          )}
          <h3 className="font-bold text-white text-sm">Cutover readiness</h3>
        </div>
        <span
          className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
            ready
              ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
              : 'text-amber-400 border-amber-500/40 bg-amber-500/10'
          }`}
        >
          {ready ? 'READY TO FLIP' : 'NOT READY'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        <ReadinessGate
          label="Distinct projects"
          value={String(nProjects)}
          target={`≥ ${READINESS_MIN_PROJECTS}`}
          pass={projectsPass}
          evaluable={true}
        />
        <ReadinessGate
          label="Max |drift|"
          value={fmtPct(maxDrift)}
          target={`≤ ${READINESS_MAX_DRIFT_PCT}%`}
          pass={driftPass}
          evaluable={maxDrift != null}
        />
        <ReadinessGate
          label="Shadow reliability"
          value={reliabilityPct == null ? '—' : `${reliabilityPct.toFixed(1)}%`}
          target={`≥ ${READINESS_MIN_RELIABILITY_PCT}%`}
          pass={reliabilityPass}
          evaluable={reliabilityPct != null}
        />
      </div>

      <div className="rounded-lg bg-slate-950/50 border border-slate-800/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
            Throwing-cause breakdown (last 30 d)
          </div>
          <span className="text-[10px] text-slate-500 font-mono">{fail} fail total</span>
        </div>
        {causes.length === 0 ? (
          <span className="text-xs text-emerald-400/80 italic">
            No shadow-run failures — engine threw on nothing.
          </span>
        ) : (
          <div className="space-y-1.5">
            {causes.map((c, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-slate-300 font-mono leading-snug break-words">
                  {c.cause}
                </span>
                <span className="text-amber-400 font-mono whitespace-nowrap shrink-0">
                  {c.count}× · {c.n_projects} proj
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500 mt-3">
        Phase-2 cutover flips the cert-grade manualJ8 engine from shadow-run to the displayed result, unblocking revenue-eligible permit sales. All three gates must be green on real production data before flipping.
      </p>
    </div>
  );
}

function ReadinessGate({
  label, value, target, pass, evaluable,
}: {
  label: string;
  value: string;
  target: string;
  pass: boolean;
  evaluable: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-950/50 border border-slate-800/50 p-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
        {evaluable ? (
          pass ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          )
        ) : null}
      </div>
      <div
        className={`font-bold tabular-nums text-base mt-0.5 ${
          !evaluable ? 'text-slate-500' : pass ? 'text-emerald-400' : 'text-amber-400'
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5 font-mono">target {target}</div>
    </div>
  );
}

function CertificationCard({ cert }: { cert: {
  engineVersion: string;
  standard: string;
  suiteTolerance: number;
  tests: Array<{ name: string; passed: number; total: number; maxDriftPct: number }>;
  aggregate: { passed: number; total: number };
  frontendUnitTests: { passed: number; total: number; framework: string };
  submission: { filed: boolean; filedAt: string; contact: string; status: string; slaMonths: number };
}}) {
  const allPass = cert.aggregate.passed === cert.aggregate.total;
  const submissionStatusMap: Record<string, { label: string; tone: string }> = {
    awaiting_review: { label: 'Awaiting ACCA review', tone: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
    approved: { label: 'Approved', tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    rejected: { label: 'Rejected', tone: 'text-red-400 border-red-500/30 bg-red-500/10' },
    not_filed: { label: 'Not filed', tone: 'text-slate-400 border-slate-600/30 bg-slate-700/10' },
  };
  const sub = submissionStatusMap[cert.submission.status] ?? submissionStatusMap.not_filed;

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4 mb-3">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className={`w-4 h-4 ${allPass ? 'text-emerald-400' : 'text-amber-400'}`} />
            <h3 className="font-bold text-white text-sm">Engine certification</h3>
          </div>
          <p className="text-[11px] text-slate-500 font-mono">
            {cert.standard} · {cert.engineVersion} · ±{(cert.suiteTolerance * 100).toFixed(1)}% tolerance
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${sub.tone}`}>
          {sub.label} · filed {cert.submission.filedAt}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        {cert.tests.map((t) => (
          <div key={t.name} className="rounded-lg bg-slate-950/50 border border-slate-800/50 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t.name}</div>
            <div className="font-bold text-white tabular-nums text-base mt-0.5">
              {t.passed}/{t.total}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
              max drift {(t.maxDriftPct * 100).toFixed(3)}%
            </div>
          </div>
        ))}
        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/30 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-500 font-bold">ACCA aggregate</div>
          <div className="font-bold text-emerald-300 tabular-nums text-base mt-0.5">
            {cert.aggregate.passed}/{cert.aggregate.total}
          </div>
          <div className="text-[10px] text-emerald-500/70 mt-0.5 font-mono">cert checks</div>
        </div>
        <div className="rounded-lg bg-slate-950/50 border border-slate-800/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Unit tests</div>
          <div className="font-bold text-white tabular-nums text-base mt-0.5">
            {cert.frontendUnitTests.passed}/{cert.frontendUnitTests.total}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{cert.frontendUnitTests.framework}</div>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Submitted to <span className="text-slate-400 font-mono">{cert.submission.contact}</span>; ACCA review SLA ≈ {cert.submission.slaMonths} months.
      </p>
    </div>
  );
}

function CalcTelemetryCards({
  volume, duration, audit,
}: {
  volume: { total: number; d24h: number; d7: number; d30: number; d30_complete: number; d30_error: number; d30_pending: number };
  duration: { sample_size: number | null; p50: number | null; p95: number | null; p99: number | null; p100: number | null };
  audit: { total: number; d24h: number; d7: number; d30: number };
}) {
  const errorRate = volume.d30 > 0
    ? ((volume.d30_error / volume.d30) * 100).toFixed(1)
    : '0.0';
  const sloP95Target = 1000; // ms — see CLAUDE.md SLOs
  const p95Ok = duration.p95 != null && duration.p95 <= sloP95Target;

  const fmtMs = (ms: number | null) => ms == null ? '—' : `${Math.round(ms)} ms`;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div className="rounded-xl border border-slate-800/40 bg-slate-900/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
            <Database className="w-3 h-3" /> Calc volume
          </div>
          <div className="font-bold text-white tabular-nums text-2xl">{volume.total.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {volume.d24h} in 24h · {volume.d7} in 7d · {volume.d30} in 30d
          </div>
        </div>
        <div className="rounded-xl border border-slate-800/40 bg-slate-900/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Status mix (30d)</div>
          <div className="text-xs space-y-0.5 mt-1">
            <div className="flex justify-between">
              <span className="text-emerald-400">complete</span>
              <span className="text-slate-300 font-mono">{volume.d30_complete}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-red-400">error</span>
              <span className="text-slate-300 font-mono">{volume.d30_error}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-amber-400">pending</span>
              <span className="text-slate-300 font-mono">{volume.d30_pending}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800/60 pt-0.5 mt-1">
              <span className="text-slate-500">error rate</span>
              <span className={`font-mono font-bold ${parseFloat(errorRate) > 1 ? 'text-red-400' : 'text-emerald-400'}`}>{errorRate}%</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800/40 bg-slate-900/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
            <Gauge className="w-3 h-3" /> Calc duration (30d)
          </div>
          <div className="text-xs space-y-0.5 mt-1">
            <div className="flex justify-between">
              <span className="text-slate-500">p50</span>
              <span className="text-slate-300 font-mono">{fmtMs(duration.p50)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">p95</span>
              <span className={`font-mono font-bold ${p95Ok ? 'text-emerald-400' : 'text-amber-400'}`}>{fmtMs(duration.p95)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">p99</span>
              <span className="text-slate-300 font-mono">{fmtMs(duration.p99)}</span>
            </div>
            <div className="flex justify-between text-[9px] text-slate-600 border-t border-slate-800/60 pt-0.5 mt-1">
              <span>SLO p95 ≤ 1000 ms</span>
              <span>n = {duration.sample_size ?? 0}</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800/40 bg-slate-900/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
            <Activity className="w-3 h-3" /> Audit events
          </div>
          <div className="font-bold text-white tabular-nums text-2xl">{audit.total.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {audit.d24h} in 24h · {audit.d7} in 7d · {audit.d30} in 30d
          </div>
        </div>
      </div>
    </>
  );
}

function EngineVersionTable({ rows }: { rows: Array<{ engine_version: string; calc_type: string; count: number }> }) {
  return (
    <div className="rounded-xl bg-slate-900/40 border border-slate-800/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">
        Engine versions in production
      </div>
      {rows.length === 0 ? (
        <span className="text-xs text-slate-600 italic">No persisted calculations yet — telemetry begins as users save.</span>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-xs gap-3">
              <span className="text-slate-300 font-mono truncate">{r.engine_version || '(unstamped)'}</span>
              <span className="text-slate-500 text-[10px] uppercase tracking-wider flex-shrink-0">{r.calc_type}</span>
              <span className="text-slate-400 font-mono text-right w-12 flex-shrink-0">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Organisations ────────────────────────────────────────────────────────────
function OrgsSection() {
  const tick = useRefreshTick();
  const [state] = useLoad(() => api.platformOrgs(), [tick]);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const orgs = state.status === 'ok' ? state.data.organisations : [];
  const filtered = useMemo(() => {
    if (!filter.trim()) return orgs;
    const q = filter.toLowerCase();
    return orgs.filter((o) =>
      o.name?.toLowerCase().includes(q) ||
      o.slug?.toLowerCase().includes(q) ||
      o.org_type?.toLowerCase().includes(q)
    );
  }, [orgs, filter]);

  return (
    <SectionShell
      icon={<Building2 className="w-4 h-4" />}
      title="Organisations"
      subtitle={state.status === 'ok' ? `${state.data.organisations.length} total — click a row for detail` : 'Loading…'}
      loading={state.status === 'loading'}
    >
      {state.status === 'error' && <ErrorBlock message={state.message} />}
      {state.status === 'ok' && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name, slug, type…"
                className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800/60">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/50 border-b border-slate-800/60">
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-bold">Name</th>
                  <th className="px-3 py-2 font-bold">Type</th>
                  <th className="px-3 py-2 font-bold">Plan</th>
                  <th className="px-3 py-2 font-bold">Billing</th>
                  <th className="px-3 py-2 font-bold text-right">Users</th>
                  <th className="px-3 py-2 font-bold text-right">Projects</th>
                  <th className="px-3 py-2 font-bold">Last active</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((org) => (
                  <tr
                    key={org.id}
                    onClick={() => setSelectedId(org.id === selectedId ? null : org.id)}
                    className={`border-t border-slate-800/40 hover:bg-slate-800/30 cursor-pointer ${selectedId === org.id ? 'bg-amber-500/5' : ''}`}
                  >
                    <td className="px-3 py-2 font-semibold text-white">
                      {org.name}
                      <div className="text-[10px] text-slate-600 font-mono">{org.slug}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{org.org_type}</td>
                    <td className="px-3 py-2 text-slate-400">{org.plan}</td>
                    <td className="px-3 py-2">
                      <BillingChip status={org.billing_status} />
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300 font-mono">{org.user_count}</td>
                    <td className="px-3 py-2 text-right text-slate-300 font-mono">{org.project_count}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {org.last_active_at ? new Date(org.last_active_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <ChevronRight className={`w-4 h-4 text-slate-600 transition-transform ${selectedId === org.id ? 'rotate-90 text-amber-400' : ''}`} />
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500 text-sm">No matches.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedId && <OrgDetailPanel id={selectedId} onClose={() => setSelectedId(null)} />}

          <RawJsonDrawer payload={state.data} />
        </>
      )}
    </SectionShell>
  );
}

function OrgDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const tick = useRefreshTick();
  const [state, refresh] = useLoad(() => api.platformOrgDetail(id), [id, tick]);
  // Banner messages for the cross-tenant role/authority/remove flow.
  // Local state — the L0 admin sees their own success/failure for the
  // action they just took without polluting the rest of the page.
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState(false);

  const callerId = useAuthStore((s) => s.user?.id) ?? null;
  const callerOrgId = useAuthStore((s) => s.organisation?.id) ?? null;
  const enterImpersonation = useAuthStore((s) => s.enterImpersonation);

  const handleImpersonate = async () => {
    if (!confirm(
      'Open a read-only view of this tenant as their admin?\n\n' +
      'The session lasts 30 minutes, blocks all changes, and is fully audited.'
    )) return;
    setImpersonating(true);
    const ok = await enterImpersonation(id);
    if (ok) {
      // Hard navigation so every store re-initializes under the tenant's
      // org context (project list, access policy, preferences scope).
      window.location.assign('/dashboard');
      return;
    }
    setImpersonating(false);
    setErr('Could not start impersonation — see the toast for details.');
  };

  const wrap = async (userId: string, fn: () => Promise<string>) => {
    setErr(null);
    setInfo(null);
    setPendingId(userId);
    try {
      const msg = await fn();
      setInfo(msg);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="mt-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold text-amber-400 text-sm flex items-center gap-2">
          <Users className="w-4 h-4" /> Org detail
        </h4>
        <div className="flex items-center gap-2">
          {id !== callerOrgId && (
            <button
              onClick={handleImpersonate}
              disabled={impersonating}
              className="flex items-center gap-1.5 text-xs font-bold text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/30 border border-amber-500/30 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
              title="Read-only 30-minute session as this tenant's admin — fully audited"
            >
              <Eye className="w-3 h-3" />
              {impersonating ? 'Starting…' : 'View as tenant'}
            </button>
          )}
          <button
            onClick={refresh}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800/60"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800/60"
          >
            Close
          </button>
        </div>
      </div>

      {state.status === 'loading' && <p className="text-xs text-slate-500">Loading…</p>}
      {state.status === 'error' && <ErrorBlock message={state.message} />}
      {state.status === 'ok' && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
            <Stat label="Projects" value={state.data.counts.project_count} compact />
            <Stat label="Calculations" value={state.data.counts.calculation_count} compact />
            <Stat label="Drawings" value={state.data.counts.drawing_count} compact />
          </div>

          {info && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> {info}
            </div>
          )}
          {err && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {err}
            </div>
          )}

          <h5 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2 flex items-center gap-2">
            <span>Members ({state.data.users.length})</span>
            <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal">
              · L0 actions log to audit feed with platform_action=1
            </span>
          </h5>
          <div className="space-y-1">
            {state.data.users.map((u) => {
              const userId = u.id as string;
              const isSelf = callerId === userId;
              const role = u.role as 'admin' | 'engineer' | 'tech' | 'viewer';
              const isAuth = Number(u.is_permit_authority ?? 0) === 1;
              const busy = pendingId === userId;
              return (
                <div
                  key={userId}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/40 text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-slate-200">{u.first_name as string} {u.last_name as string}</span>
                    <span className="text-slate-500 ml-2 font-mono truncate">{u.email as string}</span>
                  </div>

                  {u.is_platform_admin === 1 && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                      Platform
                    </span>
                  )}
                  {!u.is_verified && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-500">
                      Pending
                    </span>
                  )}
                  {isSelf && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400">
                      You
                    </span>
                  )}

                  {/* Role dropdown — disabled for self (server enforces). */}
                  <select
                    value={role}
                    disabled={isSelf || busy}
                    onChange={(e) => {
                      const next = e.target.value as 'admin' | 'engineer' | 'tech' | 'viewer';
                      if (next === role) return;
                      void wrap(userId, async () => {
                        await api.platformUpdateUser(id, userId, { role: next });
                        return `${u.email as string}: role → ${next}`;
                      });
                    }}
                    className="bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 px-1.5 py-1 disabled:opacity-50"
                    title={isSelf ? "Use your tenant's /team page to change your own role" : 'Change role'}
                  >
                    <option value="admin">admin</option>
                    <option value="engineer">engineer</option>
                    <option value="tech">tech</option>
                    <option value="viewer">viewer</option>
                  </select>

                  {/* Authority flag toggle */}
                  <button
                    disabled={isSelf || busy}
                    onClick={() => {
                      void wrap(userId, async () => {
                        await api.platformUpdateUser(id, userId, { isPermitAuthority: !isAuth });
                        return `${u.email as string}: authority ${!isAuth ? 'enabled' : 'disabled'}`;
                      });
                    }}
                    className={`px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors min-w-[44px] ${
                      isAuth
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                        : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-amber-500/30'
                    } disabled:opacity-50`}
                    title="Toggle permit-authority flag"
                  >
                    {isAuth ? 'Auth' : 'Off'}
                  </button>

                  {/* Remove button — destructive, requires confirm. */}
                  <button
                    disabled={isSelf || busy}
                    onClick={() => {
                      if (!confirm(`Remove ${u.email as string} from this organisation? This cannot be undone.`)) return;
                      void wrap(userId, async () => {
                        await api.platformRemoveUser(id, userId);
                        return `${u.email as string}: removed from organisation`;
                      });
                    }}
                    className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 min-w-[28px] min-h-[28px] flex items-center justify-center"
                    title={isSelf ? 'You cannot remove yourself' : 'Remove member from organisation'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <RawJsonDrawer payload={state.data} />
        </>
      )}
    </div>
  );
}

// ── Audit ────────────────────────────────────────────────────────────────────
function AuditSection() {
  // Renders the shared rich audit log view in platform scope, with filters,
  // drill-through, before/after diffs, and pagination — same component as the
  // tenant-facing /audit-log page. Keyed on the global refresh tick so a manual
  // refresh (or the auto-interval) remounts it with a fresh first page.
  const tick = useRefreshTick();
  return (
    <SectionShell
      icon={<Activity className="w-4 h-4" />}
      title="Audit log"
      subtitle="Every authenticated mutation across every tenant — filter, drill, expand for diffs"
    >
      <AuditLogView key={tick} scope="platform" showOrgFilter />
    </SectionShell>
  );
}

// ── Action Lab ───────────────────────────────────────────────────────────────
// All planned units have shipped to their real surfaces — this section now
// documents where each one lives instead of holding placeholders. New
// endpoint smoke-test buttons land here again when a future unit needs one.
function ActionLabSection() {
  const jumps: Array<{ id: string; label: string }> = [
    { id: 'metrics', label: 'Metrics' },
    { id: 'qa', label: 'Q/A Benchmarks' },
    { id: 'orgs', label: 'Organisations' },
    { id: 'audit', label: 'Audit Log' },
  ];
  const shipped: Array<{ name: string; where: string }> = [
    { name: 'Domain claim', where: 'Team page → Domain card (PUT /api/org/domain)' },
    { name: 'Issue invite', where: 'Team page → Invite card (email delivery via Resend)' },
    { name: 'Submit for review', where: 'Permits rail → SubmitForReviewModal (lifecycle v2)' },
    { name: 'Subdivision tree', where: 'Team page → Subdivisions card (/api/org/subdivisions)' },
    { name: 'Reparent user', where: 'Team page → Transfer card + in-app consent banner' },
    { name: 'Impersonate org', where: 'Organisations → open a row → “View as tenant” (read-only, 30 min)' },
  ];
  return (
    <SectionShell
      icon={<FlaskConical className="w-4 h-4" />}
      title="Action lab"
      subtitle="Operator tools + where each shipped unit now lives"
    >
      <div className="rounded-xl bg-slate-900/40 border border-slate-800/40 p-3 mb-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Jump to a monitored panel</div>
        <div className="flex flex-wrap gap-2">
          {jumps.map((j) => (
            <a
              key={j.id}
              href={`#${j.id}`}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/50 px-2.5 py-1.5 rounded-lg transition-colors min-h-[36px]"
            >
              <ChevronRight className="w-3 h-3 text-amber-400" /> {j.label}
            </a>
          ))}
        </div>
      </div>

      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Where each unit lives</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {shipped.map((s) => (
          <div key={s.name} className="rounded-xl bg-slate-900/40 border border-slate-800/40 p-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-sm text-slate-300">{s.name}</div>
              <p className="text-[11px] text-slate-500">{s.where}</p>
            </div>
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Shipped</span>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

// ── Reusable bits ────────────────────────────────────────────────────────────
function SectionShell({
  icon, title, subtitle, loading, children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-2xl border border-slate-800/60 p-5">
      <header className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-slate-800/60 flex items-center justify-center text-amber-400 shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-white text-base">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {loading && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500 shrink-0" aria-live="polite">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> updating…
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, hint, compact = false }: { label: string; value: number | string; hint?: string; compact?: boolean }) {
  return (
    <div className={`rounded-xl bg-slate-900/40 border border-slate-800/40 ${compact ? 'p-2' : 'p-3'}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className={`font-bold text-white tabular-nums ${compact ? 'text-base' : 'text-2xl'}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Array<[string | undefined, number]> }) {
  return (
    <div className="rounded-xl bg-slate-900/40 border border-slate-800/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">{title}</div>
      <div className="space-y-1">
        {rows.length === 0 ? (
          <span className="text-xs text-slate-600 italic">empty</span>
        ) : (
          rows.map(([key, count], i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">{key ?? 'unknown'}</span>
              <span className="text-slate-500 font-mono">{count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function BillingChip({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    free_beta: { color: 'bg-slate-700/30 text-slate-400 border-slate-600/30', label: 'Free beta', icon: <Cloud className="w-3 h-3" /> },
    trialing: { color: 'bg-amber-500/10 text-amber-400 border-amber-500/30', label: 'Trial', icon: <Cloud className="w-3 h-3" /> },
    active: { color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', label: 'Active', icon: <Cloud className="w-3 h-3" /> },
    past_due: { color: 'bg-orange-500/10 text-orange-400 border-orange-500/30', label: 'Past due', icon: <AlertTriangle className="w-3 h-3" /> },
    canceled: { color: 'bg-red-500/10 text-red-400 border-red-500/30', label: 'Canceled', icon: <AlertTriangle className="w-3 h-3" /> },
  };
  const cfg = map[status] ?? { color: 'bg-slate-700/30 text-slate-400 border-slate-600/30', label: status, icon: null };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      {message}
    </div>
  );
}

function RawJsonDrawer({ payload }: { payload: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 font-mono uppercase tracking-wider"
      >
        {open ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        {open ? 'Hide' : 'Show'} raw JSON
      </button>
      {open && (
        <pre className="mt-2 p-3 rounded-lg bg-slate-950/80 border border-slate-800/60 text-[10px] text-slate-400 font-mono overflow-x-auto max-h-64">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
