/**
 * Permits — incoming submission queue (authority view) + own submission
 * tracking (submitter view) + per-submission detail.
 *
 * Routes:
 *   /permits              — list of submissions visible to caller
 *   /permits/:id          — full detail with project payload + comments + actions
 *
 * Visibility (matches the Worker handler):
 *   - submitter: rows where submitter_org_id = caller's org
 *   - authority: + rows where authority_org_id = caller's org (when
 *                user.isPermitAuthority=1)
 *
 * Authority users see additional UI: claim, decision actions, internal
 * comment toggle. Submitters see status, decision notes, withdraw button.
 *
 * UI idiom (2026-07-22): the list is a master-detail "workbench" like
 * Settings / Admin / Team — a metallic hero, a searchable + arrangeable rail
 * of actionability FOLDERS (Inbox / In review / Active / Closed / Sent / All,
 * role-adaptive; see features/permits/permitFolders.ts) each with a live
 * count, a user-controlled refresh, and per-page persisted prefs
 * (`permits*` in usePreferencesStore). The detail view shares the metallic
 * hero + machined `Section` headers but keeps its document layout. Every
 * flow/handler is unchanged from the pre-idiom version — this is a reframe.
 */

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  ShieldCheck, ArrowLeft, RefreshCw, AlertTriangle, Clock,
  Building2, FileText, MessageSquare, Send, CheckCircle2,
  XCircle, AlertCircle, EyeOff, Eye, Hash, Activity,
  PauseCircle, PlayCircle, Ban, CalendarClock, History, RotateCcw,
  Inbox, Archive, BadgeCheck, LayoutList, Search, X,
  ArrowUpDown, Check, GripVertical, Minus, Plus,
} from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { usePreferencesStore, type UserPreferences } from '../stores/usePreferencesStore';
import { api } from '../lib/api';
import AuthorityBadge from '../components/AuthorityBadge';
import EntityAuditModal from '../components/EntityAuditModal';
import { useAccessPolicyStore } from '../stores/useAccessPolicyStore';
import SubmitForReviewModal from '../features/permits/SubmitForReviewModal';
import { buildPermitFolders, type PermitFolder } from '../features/permits/permitFolders';
import type { Project } from '../features/projects/projectStorage';

interface ListedSubmission {
  id: string; project_id: string; status: string;
  submission_type: string | null; submitted_at: string;
  reviewed_at: string | null; permit_number: string | null;
  decision_notes: string | null;
  submitter_org_id: string; authority_org_id: string;
  expires_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
  parent_submission_id: string | null;
  project_name: string | null;
  project_address: string | null; project_city: string | null;
  project_state: string | null; project_zip: string | null;
  submitter_org_name: string | null;
  authority_org_name: string | null;
  authority_title: string | null;
}

const STATUS_PALETTE: Record<string, { bg: string; text: string; border: string; label: string; icon: React.ReactNode }> = {
  submitted:         { bg: 'bg-sky-500/10',      text: 'text-sky-400',      border: 'border-sky-500/30',      label: 'Submitted',         icon: <Clock className="w-3 h-3" /> },
  under_review:      { bg: 'bg-amber-500/10',    text: 'text-amber-400',    border: 'border-amber-500/30',    label: 'Under review',      icon: <Eye className="w-3 h-3" /> },
  approved:          { bg: 'bg-emerald-500/10',  text: 'text-emerald-400',  border: 'border-emerald-500/30',  label: 'Approved',          icon: <CheckCircle2 className="w-3 h-3" /> },
  denied:            { bg: 'bg-red-500/10',      text: 'text-red-400',      border: 'border-red-500/30',      label: 'Denied',            icon: <XCircle className="w-3 h-3" /> },
  changes_requested: { bg: 'bg-orange-500/10',   text: 'text-orange-400',   border: 'border-orange-500/30',   label: 'Changes requested', icon: <AlertCircle className="w-3 h-3" /> },
  withdrawn:         { bg: 'bg-slate-700/40',    text: 'text-slate-400',    border: 'border-slate-600/40',    label: 'Withdrawn',         icon: <EyeOff className="w-3 h-3" /> },
  suspended:         { bg: 'bg-yellow-500/10',   text: 'text-yellow-300',   border: 'border-yellow-500/30',   label: 'Suspended',         icon: <PauseCircle className="w-3 h-3" /> },
  revoked:           { bg: 'bg-rose-500/15',     text: 'text-rose-300',     border: 'border-rose-500/40',     label: 'Revoked',           icon: <Ban className="w-3 h-3" /> },
  expired:           { bg: 'bg-zinc-700/50',     text: 'text-zinc-300',     border: 'border-zinc-500/40',     label: 'Expired',           icon: <CalendarClock className="w-3 h-3" /> },
};

function StatusChip({ status }: { status: string }) {
  const cfg = STATUS_PALETTE[status] ?? STATUS_PALETTE.submitted;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// Folder → rail icon. `active` gets a checkmark badge for an authority (live
// permits) but a clock for a submitter (in-flight applications), so the icon
// is resolved with role context in `iconForFolder`.
const FOLDER_ICON: Record<string, React.ReactNode> = {
  inbox: <Inbox className="w-4 h-4" />,
  'in-review': <Eye className="w-4 h-4" />,
  active: <BadgeCheck className="w-4 h-4" />,
  approved: <CheckCircle2 className="w-4 h-4" />,
  closed: <Archive className="w-4 h-4" />,
  sent: <Send className="w-4 h-4" />,
  all: <LayoutList className="w-4 h-4" />,
};
function iconForFolder(id: string, isAuthority: boolean): React.ReactNode {
  if (!isAuthority && id === 'active') return <Clock className="w-4 h-4" />;
  return FOLDER_ICON[id] ?? <LayoutList className="w-4 h-4" />;
}

// Folder view-model — the pure folder plus the page's icon + live count.
interface FolderVM extends PermitFolder {
  icon: React.ReactNode;
  count: number;
}

// Auto-refresh cadence choices for the queue's RefreshControl (mirrors Admin).
const REFRESH_OPTIONS: { label: string; ms: number }[] = [
  { label: 'Manual', ms: 0 },
  { label: '10s', ms: 10_000 },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
];

export default function PermitsPage() {
  const { id } = useParams();
  if (id) return <PermitDetail id={id} />;
  return <PermitList />;
}

// ── List view ───────────────────────────────────────────────────────────────

function PermitList() {
  const isAuthority = useAuthStore((s) => !!s.user?.isPermitAuthority);
  const myOrgId = useAuthStore((s) => s.organisation?.id ?? null);
  const [items, setItems] = useState<ListedSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => Date.now());
  const [spinning, setSpinning] = useState(false);
  const navigate = useNavigate();

  // Persisted rail state — mirrors the Settings / Admin / Team contract.
  const navOrder = usePreferencesStore((s) => s.permitsNavOrder);
  const navHidden = usePreferencesStore((s) => s.permitsNavHidden);
  const lastCategory = usePreferencesStore((s) => s.permitsLastCategory);
  const autoMs = usePreferencesStore((s) => s.permitsAutoRefreshMs);
  const updatePrefs = usePreferencesStore((s) => s.update);

  // One fetch for the whole visible queue; folders partition it client-side so
  // every folder shows an accurate live count regardless of the active folder.
  const refresh = useCallback(async () => {
    setSpinning(true);
    setErr(null);
    try {
      const r = await api.permitListSubmissions();
      setItems(r.submissions);
      setLastRefreshedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      window.setTimeout(() => setSpinning(false), 500);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // User-controlled auto-refresh — 0 = manual only. The interval bumps the same
  // fetch the manual button does.
  useEffect(() => {
    if (!autoMs) return;
    const id = window.setInterval(() => { refresh(); }, autoMs);
    return () => window.clearInterval(id);
  }, [autoMs, refresh]);

  // Folder registry for this viewer → custom order (unknown ids append,
  // forward-compatible) → view-models with icon + live count.
  const folders = useMemo(() => buildPermitFolders({ isAuthority, myOrgId }), [isAuthority, myOrgId]);
  const orderedFolders = useMemo(() => {
    if (!navOrder) return folders;
    const byId = new Map(folders.map((f) => [f.id, f]));
    const known = navOrder.map((id) => byId.get(id)).filter((f): f is PermitFolder => !!f);
    const missing = folders.filter((f) => !navOrder.includes(f.id));
    return [...known, ...missing];
  }, [folders, navOrder]);
  const orderedVM: FolderVM[] = orderedFolders.map((f) => ({
    ...f, icon: iconForFolder(f.id, isAuthority), count: items.filter(f.match).length,
  }));
  const railVM = orderedVM.filter((f) => !navHidden.includes(f.id));

  // Active folder: URL hash → last-open pref → first visible.
  const [active, setActive] = useState<string>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return hash || lastCategory || '';
  });
  const [query, setQuery] = useState('');
  const [arrangeMode, setArrangeMode] = useState(false);
  const [statusNarrow, setStatusNarrow] = useState('');

  // Resolves against the full ordered set (a deep-linked / last-open hidden
  // folder still renders), else the first visible folder.
  const activeFolder = orderedVM.find((f) => f.id === active) ?? railVM[0] ?? orderedVM[0];
  useEffect(() => {
    if (activeFolder && activeFolder.id !== active) setActive(activeFolder.id);
  }, [activeFolder, active]);

  // Follow deep-links (Cmd+K jumps, back/forward navigations).
  const location = useLocation();
  useEffect(() => {
    const h = location.hash.replace('#', '');
    if (h) { setActive(h); setQuery(''); }
  }, [location.hash]);

  const selectFolder = (id: string) => {
    setActive(id);
    setStatusNarrow('');
    updatePrefs({ permitsLastCategory: id });
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${id}`);
  };
  const pickFolder = (id: string) => { setQuery(''); selectFolder(id); };
  const enterArrange = () => { setArrangeMode(true); setQuery(''); };

  // Search runs over SUBMISSIONS (not folder names) — an officer needs to find
  // "the Ribbeck permit" fast; folders are few and always visible.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const searchResults = useMemo(() => {
    if (!searching) return [];
    return items.filter((s) => {
      const hay = [
        s.project_name, s.project_address, s.project_city, s.project_state, s.project_zip,
        s.permit_number, s.submitter_org_name, s.authority_org_name, s.authority_title,
        s.submission_type, STATUS_PALETTE[s.status]?.label ?? s.status,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [searching, items, q]);

  // Active folder's items + optional within-folder status narrowing.
  const folderItems = activeFolder ? items.filter(activeFolder.match) : [];
  const shownItems = statusNarrow ? folderItems.filter((s) => s.status === statusNarrow) : folderItems;
  const folderStatuses = (() => {
    const set = new Set(folderItems.map((s) => s.status));
    return Object.keys(STATUS_PALETTE).filter((k) => set.has(k));
  })();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        {/* Metallic hero — the same brushed plate as Settings / Team, in
            Permits' amber authority identity; refresh control docks right. */}
        <header className="mb-8">
          <div className="portal-plate portal-menu-emerge relative overflow-hidden rounded-2xl border border-slate-700/70 p-5 sm:p-6 flex items-center gap-4 sm:gap-5 flex-wrap shadow-[0_16px_50px_rgba(0,0,0,0.6)]">
            <span aria-hidden className="portal-menu-sheen absolute inset-0 pointer-events-none" />
            <div className="portal-button-metallic relative w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center shrink-0">
              <span aria-hidden className="portal-ring-metallic absolute inset-[-50%]" />
              <span aria-hidden className="absolute inset-[2px] rounded-[14px] bg-slate-950/95" />
              <ShieldCheck className="relative z-10 w-7 h-7 text-amber-300" />
            </div>
            <div className="relative z-10 min-w-0 flex-1">
              <p className="metal-ink-soft text-[10px] font-mono font-bold uppercase tracking-[0.25em]">
                {isAuthority ? 'Permit Authority' : 'Permit Submissions'}
              </p>
              <h2 className="metal-ink text-2xl sm:text-3xl font-extrabold leading-tight">Permits</h2>
              <p className="metal-ink-soft text-xs sm:text-sm font-semibold truncate">
                {isAuthority
                  ? 'Incoming submissions for your authority + your own outgoing submissions.'
                  : 'Permit submissions you have sent to authorities for review.'}
              </p>
            </div>
            <div className="relative z-10 shrink-0">
              <RefreshControl
                intervalMs={autoMs}
                onIntervalChange={(ms) => updatePrefs({ permitsAutoRefreshMs: ms })}
                onRefresh={refresh}
                lastRefreshedAt={lastRefreshedAt}
                spinning={spinning}
              />
            </div>
          </div>
        </header>

        {err && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {err}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Rail — search over submissions + arrange/hide over folders. */}
          <nav className="md:w-56 md:shrink-0 md:sticky md:top-4 self-start w-full" aria-label="Permit folders">
            {!arrangeMode && (
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search submissions…"
                  aria-label="Search submissions"
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
                onClick={() => (arrangeMode ? setArrangeMode(false) : enterArrange())}
                aria-pressed={arrangeMode}
                title={arrangeMode ? 'Done arranging' : 'Arrange folders — drag to reorder, hide what you don’t use'}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors min-h-[36px] ${arrangeMode ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'}`}
              >
                {arrangeMode ? <Check className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3.5 h-3.5" />}
                {arrangeMode ? 'Done' : 'Arrange'}
              </button>
            </div>

            {arrangeMode ? (
              <PermitsArrangeRail
                folders={orderedVM}
                hidden={navHidden}
                defaultOrder={folders.map((f) => f.id)}
                onChange={updatePrefs}
              />
            ) : (
              <PermitsRail folders={railVM} active={searching ? '' : (activeFolder?.id ?? '')} onSelect={pickFolder} />
            )}
          </nav>

          {/* Detail pane — arrange hint, search results, or the active folder. */}
          <div className="flex-1 min-w-0">
            {arrangeMode ? (
              <PermitsArrangeHint />
            ) : searching ? (
              <>
                <div className="mb-4">
                  <h3 className="text-lg font-bold text-white">
                    {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
                    <span className="text-slate-500 font-normal"> for “{query}”</span>
                  </h3>
                </div>
                {searchResults.length === 0 ? (
                  <p className="text-sm text-slate-500 py-10 text-center">No submissions match “{query}”.</p>
                ) : (
                  <div className="space-y-2">
                    {searchResults.map((s) => (
                      <SubmissionCard key={s.id} s={s} isAuthority={isAuthority} myOrgId={myOrgId} onOpen={() => navigate(`/permits/${s.id}`)} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {activeFolder && (
                  <FolderHeader
                    title={activeFolder.title}
                    count={folderItems.length}
                    statuses={folderStatuses}
                    narrow={statusNarrow}
                    onNarrow={setStatusNarrow}
                  />
                )}
                {loading && items.length === 0 ? (
                  <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>
                ) : shownItems.length === 0 ? (
                  <div className="glass-panel rounded-2xl border border-slate-800/60 p-10 text-center">
                    <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">
                      {activeFolder?.id === 'inbox'
                        ? 'Inbox is clear — no new submissions to triage.'
                        : 'No submissions in this view.'}
                    </p>
                    {!isAuthority && items.length === 0 && (
                      <p className="text-slate-500 text-xs mt-1">
                        Go to your Dashboard and click the shield icon on a project to submit it for review.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {shownItems.map((s) => (
                      <SubmissionCard key={s.id} s={s} isAuthority={isAuthority} myOrgId={myOrgId} onOpen={() => navigate(`/permits/${s.id}`)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Refresh control (ported from AdminPage; amber) ───────────────────────────
function RefreshControl({ intervalMs, onIntervalChange, onRefresh, lastRefreshedAt, spinning }: {
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
    // Seat the whole cluster on an opaque near-black panel with a faint light
    // edge + shadow. slate-950 is darker than every metal finish (steel …
    // cast-iron), so the control always separates from the plate — legibility
    // no longer depends on the hero's finish colour. Text brightened to match.
    <div className="flex items-center gap-2.5 shrink-0 rounded-xl bg-slate-950/95 border border-white/10 pl-3 pr-1.5 py-1 shadow-[0_3px_12px_rgba(0,0,0,0.6)]">
      <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-slate-300" title="When the queue last pulled fresh data">
        <Clock className="w-3 h-3" /> updated {ago}
      </span>
      <div className="flex items-center rounded-lg border border-slate-600/70 bg-slate-900/80 overflow-hidden">
        <label className="flex items-center gap-1.5 pl-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          <RefreshCw className="w-3 h-3" /> Auto
          <select
            value={intervalMs}
            onChange={(e) => onIntervalChange(Number(e.target.value))}
            className="bg-transparent text-slate-100 text-xs font-semibold py-1.5 pr-1 focus:outline-none cursor-pointer"
            aria-label="Auto-refresh interval"
            title="Auto-refresh interval for the queue"
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.ms} value={o.ms} className="bg-slate-900">{o.label}</option>
            ))}
          </select>
        </label>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-200 bg-amber-500/15 hover:bg-amber-500/30 border-l border-slate-600/70 transition-colors min-h-[40px]"
          title="Refresh the queue now"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </div>
  );
}

// ── Rail (mirrors TeamRail; amber active accent + folder count badge) ────────
function PermitsRail({ folders, active, onSelect }: { folders: FolderVM[]; active: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-1 px-1 md:mx-0 md:px-0">
      {folders.map((f) => {
        const isActive = f.id === active;
        const inboxHot = f.id === 'inbox' && f.count > 0;
        return (
          <button
            key={f.id}
            onClick={() => onSelect(f.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all min-h-[44px] whitespace-nowrap ${isActive ? 'bg-slate-800/80 text-white border border-slate-700/60 shadow-inner' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'}`}
          >
            <span className={isActive || inboxHot ? 'text-amber-400' : 'text-slate-500'}>{f.icon}</span>
            <span className="flex-1 text-left">{f.title}</span>
            <span className={`shrink-0 text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-md ${inboxHot ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : isActive ? 'bg-slate-700/60 text-slate-200' : 'bg-slate-800/60 text-slate-500'}`}>
              {f.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Arrange mode — reorder + hide folders (prefs.permitsNavOrder / permitsNavHidden).
// The Team/Admin arrange rail, retinted amber and operating on folder VMs.
function PermitsArrangeRail({ folders, hidden, defaultOrder, onChange }: {
  folders: FolderVM[];
  hidden: string[];
  defaultOrder: string[];
  onChange: (patch: Partial<UserPreferences>) => void;
}) {
  const meta = new Map(folders.map((f) => [f.id, f]));
  const ids = folders.map((f) => f.id);
  const visibleIds = ids.filter((id) => !hidden.includes(id));
  const hiddenIds = ids.filter((id) => hidden.includes(id));

  const [dragId, setDragId] = useState<string | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const liveOrderRef = useRef<string[] | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragInfo = useRef<{ id: string; startY: number; startIndex: number; rowH: number; order: string[] } | null>(null);

  const renderIds = liveOrder ?? visibleIds;

  const commit = (finalVisible: string[]) => {
    // Persist reordered VISIBLE ids with hidden ids after them (so an unhide
    // lands sensibly). Matching the registry order exactly reverts to null.
    const full = [...finalVisible, ...hiddenIds];
    const isDefault = full.length === defaultOrder.length && full.every((x, i) => x === defaultOrder[i]);
    onChange({ permitsNavOrder: isDefault ? null : full });
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

  const hideCat = (id: string) => onChange({ permitsNavHidden: [...hidden.filter((h) => h !== id), id] });
  const restoreCat = (id: string) => onChange({ permitsNavHidden: hidden.filter((h) => h !== id) });
  const reset = () => onChange({ permitsNavOrder: null, permitsNavHidden: [] });

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
        title="Reset to the default order with every folder shown"
        className="mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-amber-300 hover:bg-slate-800/60 transition-colors min-h-[36px]"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Reset order
      </button>
    </div>
  );
}

function PermitsArrangeHint() {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6 text-sm text-slate-400 leading-relaxed">
      <div className="flex items-center gap-2 mb-2 text-slate-200 font-semibold">
        <ArrowUpDown className="w-4 h-4 text-amber-400" /> Arranging folders
      </div>
      <p>
        Drag the rows on the left to reorder your Permits folders. Use the
        <span className="inline-flex items-center justify-center align-middle mx-1 w-4 h-4 rounded-full bg-slate-800 border border-slate-600"><Minus className="w-2.5 h-2.5" /></span>
        on a row to hide a folder from the rail — its submissions stay reachable from search and the other folders.
        Click <span className="text-amber-300 font-semibold">Done</span> when you're finished; your layout saves automatically to this workbench.
      </p>
    </div>
  );
}

// Folder header — title + count + a secondary status-narrowing chip row (only
// when the folder spans more than one status). Preserves the exact-status
// filtering today's dropdown offered, scoped to the active folder.
function FolderHeader({ title, count, statuses, narrow, onNarrow }: {
  title: string; count: number; statuses: string[]; narrow: string; onNarrow: (s: string) => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <span className="text-sm font-mono text-slate-500 tabular-nums">{count}</span>
      </div>
      {statuses.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {statuses.map((st) => {
            const cfg = STATUS_PALETTE[st] ?? STATUS_PALETTE.submitted;
            const on = narrow === st;
            return (
              <button
                key={st}
                onClick={() => onNarrow(on ? '' : st)}
                className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${on ? `${cfg.bg} ${cfg.text} ${cfg.border}` : 'bg-slate-900/40 text-slate-500 border-slate-700/40 hover:text-slate-300 hover:border-slate-600/60'}`}
              >
                {cfg.icon}{cfg.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Submission card — the queue row (extracted from the pre-idiom list; the
// `incoming` flag replaces the inline getState() From/To check).
function SubmissionCard({ s, isAuthority, myOrgId, onOpen }: {
  s: ListedSubmission; isAuthority: boolean; myOrgId: string | null; onOpen: () => void;
}) {
  const incoming = isAuthority && s.authority_org_id === myOrgId;
  return (
    <button
      onClick={onOpen}
      className="w-full text-left glass-panel rounded-xl border border-slate-800/60 p-4 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white text-base truncate">
            {s.project_name || 'Untitled project'}
          </h3>
          <p className="text-xs text-slate-500 truncate">
            {[s.project_address, s.project_city, s.project_state, s.project_zip].filter(Boolean).join(', ') || 'No address on file'}
          </p>
        </div>
        <StatusChip status={s.status} />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
        <span className="flex items-center gap-1">
          <Building2 className="w-3 h-3" />
          {incoming
            ? `From ${s.submitter_org_name ?? 'unknown'}`
            : `To ${s.authority_org_name ?? 'unknown'}${s.authority_title ? ` · ${s.authority_title}` : ''}`}
        </span>
        {s.submission_type && (
          <span className="font-mono uppercase tracking-wider text-[9px] text-slate-600">
            {s.submission_type.replace(/_/g, ' ')}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> {new Date(s.submitted_at).toLocaleDateString()}
        </span>
        {s.permit_number && (
          <span className="flex items-center gap-1 text-emerald-400 font-mono">
            <Hash className="w-3 h-3" /> {s.permit_number}
          </span>
        )}
      </div>
    </button>
  );
}

// Metallic machined-header section — ported from TeamPage's `Section`, with an
// optional accent (amber = action zone, violet = informational) tinting the
// icon chip + body. The header is inert (not a collapse toggle).
function Section({ icon, title, subtitle, action, accent = 'neutral', children }: {
  icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode;
  accent?: 'neutral' | 'amber' | 'violet';
  children: React.ReactNode;
}) {
  const iconColor = accent === 'violet' ? 'text-violet-400' : 'text-amber-400';
  const ring = accent === 'amber' ? 'border-amber-500/40' : 'border-slate-700/60';
  const body = accent === 'amber' ? 'bg-amber-500/[0.03]' : 'bg-slate-900/60';
  return (
    <section className={`rounded-2xl border ${ring} overflow-hidden shadow-[0_10px_36px_rgba(0,0,0,0.45)]`}>
      <header className="portal-plate relative px-5 py-3.5 flex items-center gap-3">
        <span aria-hidden className="portal-menu-sheen absolute inset-0 pointer-events-none" />
        <span className={`relative z-10 w-9 h-9 rounded-xl bg-slate-900 border-2 border-slate-950/60 flex items-center justify-center shrink-0 ${iconColor} shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),0_2px_5px_rgba(0,0,0,0.5)]`}>
          {icon}
        </span>
        <div className="relative z-10 min-w-0">
          <h3 className="metal-ink text-sm font-bold uppercase tracking-widest truncate">{title}</h3>
          {subtitle && <p className="metal-ink-soft text-[11px] font-semibold">{subtitle}</p>}
        </div>
        {action && <div className="relative z-10 ml-auto shrink-0">{action}</div>}
      </header>
      <div className={`${body} backdrop-blur-xl p-5 border-t border-slate-950/50`}>{children}</div>
    </section>
  );
}

// ── Detail view ─────────────────────────────────────────────────────────────

interface DetailData {
  submission: Record<string, unknown>;
  project: Record<string, unknown> | null;
  calculations: Array<Record<string, unknown>>;
  comments: Array<{
    id: string; body: string; is_internal: number;
    deleted_at: string | null; created_at: string;
    author_user_id: string; author_org_id: string;
    author_first_name: string | null; author_last_name: string | null;
    author_org_name: string | null;
    author_is_authority: number;
  }>;
  party: 'submitter' | 'authority' | null;
  parentSubmission: {
    id: string; status: string;
    submission_type: string | null;
    submitted_at: string;
    reviewed_at: string | null;
    decision_notes: string | null;
    permit_number: string | null;
  } | null;
}

interface Transition {
  id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  automated: number;
  created_at: string;
  actor_user_id: string | null;
  actor_first_name: string | null;
  actor_last_name: string | null;
  actor_org_name: string | null;
}

type ActionId =
  | 'claim' | 'approve' | 'deny' | 'request_changes' | 'withdraw'
  | 'suspend' | 'revoke' | 'reinstate' | 'set_expiration';

function PermitDetail({ id }: { id: string }) {
  const sessionUser = useAuthStore((s) => s.user);
  const [data, setData] = useState<DetailData | null>(null);
  const [timeline, setTimeline] = useState<Transition[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [internalDraft, setInternalDraft] = useState(false);
  const [posting, setPosting] = useState(false);
  const [showInternal, setShowInternal] = useState(true);
  const [decisionDraft, setDecisionDraft] = useState('');
  const [permitNumberDraft, setPermitNumberDraft] = useState('');
  const [expiresDraft, setExpiresDraft] = useState('');
  const [acting, setActing] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const navigate = useNavigate();
  const canViewAudit = useAccessPolicyStore((s) => s.capabilities.canViewAudit);

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [detailRes, tlRes] = await Promise.all([
        api.permitGetSubmission(id),
        api.permitGetTimeline(id),
      ]);
      setData(detailRes);
      setTimeline(tlRes.transitions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [id]);

  const post = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await api.permitAddComment(id, draft.trim(), internalDraft);
      setDraft('');
      setInternalDraft(false);
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setPosting(false); }
  };

  const act = async (action: ActionId) => {
    const reasonRequired = ['deny', 'request_changes', 'suspend', 'revoke', 'reinstate'];
    if (reasonRequired.includes(action) && !decisionDraft.trim()) {
      setErr(`A reason is required for '${action.replace(/_/g, ' ')}'.`);
      return;
    }
    if (action === 'set_expiration' && !expiresDraft.trim()) {
      setErr('Pick a date/time to set the expiration.');
      return;
    }
    setActing(true);
    try {
      await api.permitAct(id, {
        action,
        decisionNotes: decisionDraft.trim() || undefined,
        permitNumber: action === 'approve' ? (permitNumberDraft.trim() || undefined) : undefined,
        expiresAt:
          action === 'set_expiration' ? expiresDraft :
          action === 'approve' && expiresDraft.trim() ? expiresDraft :
          undefined,
      });
      setDecisionDraft('');
      setPermitNumberDraft('');
      setExpiresDraft('');
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setActing(false); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        <EntityAuditModal
          isOpen={auditOpen}
          onClose={() => setAuditOpen(false)}
          entityType="permit_submission"
          entityId={id}
          label={
            (data?.project?.name as string) ||
            (data?.submission?.permit_number as string) ||
            `Submission ${id.slice(0, 8)}`
          }
          context="Permit submission"
        />

        {err && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {err}
          </div>
        )}

        {loading && !data && <p className="text-sm text-slate-500">Loading…</p>}

        {data && data.parentSubmission && (
          <ParentSubmissionBreadcrumb parent={data.parentSubmission} />
        )}

        {/* Metallic hero — carries the submission identity + the Back / Refresh /
            Activity affordances that used to sit in a plain top bar. */}
        {data && data.submission && (
          <DetailHero
            submission={data.submission}
            project={data.project}
            canViewAudit={canViewAudit}
            loading={loading}
            onRefresh={refresh}
            onActivity={() => setAuditOpen(true)}
          />
        )}

        {/* Read (details) → decide (actions) → history → payload → discussion.
            Every card wears the shared machined Section header; handlers are
            unchanged from the pre-idiom view. */}
        <div className="space-y-6">
          {data && data.submission && (
            <SubmissionDetails submission={data.submission} />
          )}

          {data && data.party === 'authority' && data.submission && (
            <AuthorityActions
              submission={data.submission}
              decisionDraft={decisionDraft}
              setDecisionDraft={setDecisionDraft}
              permitNumberDraft={permitNumberDraft}
              setPermitNumberDraft={setPermitNumberDraft}
              expiresDraft={expiresDraft}
              setExpiresDraft={setExpiresDraft}
              acting={acting}
              onAct={act}
            />
          )}

          {data && data.party === 'submitter' && data.submission && (
            <SubmitterActions
              submission={data.submission}
              acting={acting}
              onWithdraw={() => act('withdraw')}
              onResubmit={() => setResubmitOpen(true)}
            />
          )}

          {data && timeline.length > 0 && (
            <LifecycleTimeline transitions={timeline} />
          )}

          {data && data.project && (
            <ProjectPayload project={data.project} calculations={data.calculations} />
          )}

          {data && (
            <CommentThread
              comments={data.comments}
              sessionUserId={sessionUser?.id ?? null}
              isAuthority={data.party === 'authority'}
              showInternal={showInternal}
              setShowInternal={setShowInternal}
              draft={draft}
              setDraft={setDraft}
              internalDraft={internalDraft}
              setInternalDraft={setInternalDraft}
              onPost={post}
              posting={posting}
            />
          )}
        </div>

        {/* Resubmit modal — opened by SubmitterActions on terminal non-success
            states. parentSubmissionId chains the new submission to this one
            so the reviewer sees thread-of-history. After submit, navigate
            to the new submission. */}
        {resubmitOpen && data?.project && (
          <SubmitForReviewModal
            project={shapeProjectForModal(data.project)}
            parentSubmissionId={id}
            onClose={() => setResubmitOpen(false)}
            onSubmitted={(newId) => {
              setResubmitOpen(false);
              navigate(`/permits/${newId}`);
            }}
          />
        )}
      </div>
    </div>
  );
}

function ParentSubmissionBreadcrumb({ parent }: { parent: NonNullable<DetailData['parentSubmission']> }) {
  return (
    <div className="mb-4 glass-panel rounded-xl border border-slate-700/40 bg-slate-900/30 px-4 py-3 flex items-center gap-3 flex-wrap">
      <RotateCcw className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
          Resubmission of a prior submission
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Link
            to={`/permits/${parent.id}`}
            className="text-xs font-mono text-amber-400 hover:underline"
          >
            {parent.id.slice(0, 8)}…
          </Link>
          <StatusChip status={parent.status} />
          <span className="text-[11px] text-slate-500">
            originally submitted {new Date(parent.submitted_at).toLocaleDateString()}
          </span>
          {parent.permit_number && (
            <span className="text-[11px] text-emerald-400 font-mono">
              <Hash className="w-3 h-3 inline" /> {parent.permit_number}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LifecycleTimeline({ transitions }: { transitions: Transition[] }) {
  return (
    <Section icon={<History className="w-4 h-4" />} title={`Lifecycle (${transitions.length})`} accent="violet">
      <ol className="space-y-2">
        {transitions.map((t) => {
          const cfg = STATUS_PALETTE[t.to_status] ?? STATUS_PALETTE.submitted;
          const actorName = [t.actor_first_name, t.actor_last_name]
            .filter(Boolean).join(' ');
          return (
            <li key={t.id} className="flex items-start gap-3 text-xs">
              <span className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                {cfg.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-bold text-slate-200">
                    {t.from_status ? `${prettyStatus(t.from_status)} → ` : ''}
                    {prettyStatus(t.to_status)}
                  </span>
                  {t.automated === 1 && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-300 border border-zinc-500/30">
                      auto
                    </span>
                  )}
                  <span className="text-[10px] text-slate-600 font-mono ml-auto">
                    {new Date(t.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
                  {actorName && <span>{actorName}</span>}
                  {t.actor_org_name && <span>· {t.actor_org_name}</span>}
                  {!actorName && t.automated === 1 && <span className="italic">system</span>}
                </div>
                {t.reason && (
                  <p className="text-[11px] text-slate-400 mt-1 whitespace-pre-wrap">{t.reason}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function prettyStatus(s: string): string {
  return STATUS_PALETTE[s]?.label ?? s.replace(/_/g, ' ');
}

/** Adapt the loosely-typed project row from the submission-detail payload
 *  into the Project shape SubmitForReviewModal needs. Only address / id /
 *  name fields are used by the modal; other Project fields default. */
function shapeProjectForModal(p: Record<string, unknown>): Project {
  return {
    id: (p.id as string) ?? '',
    name: (p.name as string) ?? '',
    type: (p.type as string) ?? 'Residential',
    address: (p.address as string) ?? '',
    city: (p.city as string) ?? '',
    state: (p.state as string) ?? undefined,
    zip: (p.zip as string) ?? undefined,
    climateZone: (p.climate_zone as string) ?? undefined,
    standard: (p.standard as string) ?? undefined,
    status: (p.status as string) ?? 'In Progress',
    date: (p.created_at as string) ?? new Date().toISOString(),
  } as Project;
}

// Metallic hero for a single submission — mark + identity + the Back / Refresh
// / Activity controls that used to live in a plain top bar. The rich metadata
// moves into the SubmissionDetails Section below so the plate stays clean.
function DetailHero({ submission, project, canViewAudit, loading, onRefresh, onActivity }: {
  submission: Record<string, unknown>;
  project: Record<string, unknown> | null;
  canViewAudit: boolean;
  loading: boolean;
  onRefresh: () => void;
  onActivity: () => void;
}) {
  const status = (submission.status as string) ?? 'submitted';
  const submissionType = submission.submission_type as string | null | undefined;
  const permitNumber = submission.permit_number as string | null | undefined;

  return (
    <header className="mb-6">
      <div className="portal-plate portal-menu-emerge relative overflow-hidden rounded-2xl border border-slate-700/70 p-5 sm:p-6 shadow-[0_16px_50px_rgba(0,0,0,0.6)]">
        <span aria-hidden className="portal-menu-sheen absolute inset-0 pointer-events-none" />
        <div className="relative z-10 flex items-start gap-4 flex-wrap">
          <div className="portal-button-metallic relative w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center shrink-0">
            <span aria-hidden className="portal-ring-metallic absolute inset-[-50%]" />
            <span aria-hidden className="absolute inset-[2px] rounded-[14px] bg-slate-950/95" />
            <ShieldCheck className="relative z-10 w-6 h-6 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="metal-ink-soft text-[10px] font-mono font-bold uppercase tracking-[0.25em]">
              {submissionType ? submissionType.replace(/_/g, ' ') : 'Submission'}
            </p>
            <h1 className="metal-ink text-2xl font-extrabold leading-tight truncate">
              {(project?.name as string) || 'Untitled project'}
            </h1>
            <p className="metal-ink-soft text-xs sm:text-sm font-semibold truncate">
              {[project?.address, project?.city, project?.state, project?.zip].filter(Boolean).join(', ') || 'No address'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <StatusChip status={status} />
            {permitNumber && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-300">
                <Hash className="w-3 h-3" /> {permitNumber}
              </span>
            )}
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-2 mt-4 flex-wrap">
          <Link
            to="/permits"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/90 hover:bg-slate-900/90 border border-white/10 text-sm text-slate-200 hover:text-amber-300 transition-colors min-h-[40px]"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Permits
          </Link>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/90 hover:bg-slate-900/90 border border-white/10 text-sm text-slate-200 hover:text-white transition-colors min-h-[40px] disabled:opacity-50"
            title="Reload this submission"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          {canViewAudit && (
            <button
              type="button"
              onClick={onActivity}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/90 hover:bg-slate-900/90 border border-white/10 text-sm text-slate-200 hover:text-emerald-300 transition-colors min-h-[40px]"
              title="Full audit trail for this permit submission"
            >
              <Activity className="w-4 h-4" />
              <span className="hidden sm:inline">Activity</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

// Submission metadata — the From/To grid + cover letter + decision / intake
// notes, in the shared machined Section (was the body of SubmissionHeader).
function SubmissionDetails({ submission }: { submission: Record<string, unknown> }) {
  const submittedAt = submission.submitted_at as string | undefined;
  const reviewedAt = submission.reviewed_at as string | null | undefined;
  const permitNumber = submission.permit_number as string | null | undefined;
  const submissionType = submission.submission_type as string | null | undefined;
  const coverLetter = submission.cover_letter as string | null | undefined;
  const submitterOrgName = submission.submitter_org_name as string | null | undefined;
  const authorityOrgName = submission.authority_org_name as string | null | undefined;
  const authorityTitle = submission.authority_title as string | null | undefined;
  const decisionNotes = submission.decision_notes as string | null | undefined;
  const intakeNotes = submission.authority_intake_notes as string | null | undefined;

  return (
    <Section icon={<FileText className="w-4 h-4" />} title="Submission details">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-400">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">From</div>
          <div className="font-semibold text-slate-200">{submitterOrgName ?? '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">To</div>
          <div className="font-semibold text-slate-200">
            {authorityOrgName ?? '—'} {authorityTitle ? <span className="text-slate-500">· {authorityTitle}</span> : null}
          </div>
        </div>
        {submissionType && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Submission type</div>
            <div className="font-mono uppercase tracking-wider text-[10px] text-slate-300">
              {submissionType.replace(/_/g, ' ')}
            </div>
          </div>
        )}
        {permitNumber && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Permit number</div>
            <div className="font-mono text-emerald-400">{permitNumber}</div>
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Submitted</div>
          <div>{submittedAt ? new Date(submittedAt).toLocaleString() : '—'}</div>
        </div>
        {reviewedAt && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Last decision</div>
            <div>{new Date(reviewedAt).toLocaleString()}</div>
          </div>
        )}
      </div>

      {coverLetter && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Cover letter</div>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{coverLetter}</p>
        </div>
      )}

      {decisionNotes && (
        <div className="mt-4 p-3 rounded-lg bg-slate-900/40 border border-slate-700/40">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold mb-1">Authority decision notes</div>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{decisionNotes}</p>
        </div>
      )}

      {intakeNotes && (
        <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold mb-1">Authority intake process</div>
          <p className="text-xs text-slate-400 whitespace-pre-wrap">{intakeNotes}</p>
        </div>
      )}
    </Section>
  );
}

function AuthorityActions({ submission, decisionDraft, setDecisionDraft, permitNumberDraft, setPermitNumberDraft, expiresDraft, setExpiresDraft, acting, onAct }: {
  submission: Record<string, unknown>;
  decisionDraft: string; setDecisionDraft: (s: string) => void;
  permitNumberDraft: string; setPermitNumberDraft: (s: string) => void;
  expiresDraft: string; setExpiresDraft: (s: string) => void;
  acting: boolean;
  onAct: (a: ActionId) => void;
}) {
  const status = submission.status as string;
  const expiresAt = submission.expires_at as string | null | undefined;

  // Pre-decision: claim/approve/deny/request_changes
  const inPreDecision = ['submitted', 'under_review', 'changes_requested'].includes(status);
  // Post-decision lifecycle states the authority can still act on
  const inActiveLifecycle = ['approved', 'suspended'].includes(status);

  if (!inPreDecision && !inActiveLifecycle) return null;

  return (
    <Section icon={<ShieldCheck className="w-4 h-4" />} title="Authority actions" accent="amber">
      {inPreDecision && (
        <>
          {status === 'submitted' && (
            <div className="mb-3">
              <button
                onClick={() => onAct('claim')}
                disabled={acting}
                className="bg-amber-500/10 text-amber-300 border border-amber-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-all disabled:opacity-50"
              >
                <Eye className="w-3.5 h-3.5 inline mr-1" /> Claim & start review
              </button>
              <p className="text-[11px] text-slate-500 mt-2">Marks this submission as <em>under review</em> by you. Reviewer assignment is logged.</p>
            </div>
          )}

          <div className="space-y-2">
            <textarea
              value={decisionDraft}
              onChange={(e) => setDecisionDraft(e.target.value)}
              placeholder="Decision notes (required for deny / request changes; optional for approve)…"
              rows={3}
              className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y"
            />
            <input
              value={permitNumberDraft}
              onChange={(e) => setPermitNumberDraft(e.target.value)}
              placeholder="Permit number (optional, for approval)"
              className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold pt-1">
              Expiration (optional — sets auto-expire timer at approval time)
            </label>
            <input
              type="datetime-local"
              value={expiresDraft}
              onChange={(e) => setExpiresDraft(e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <button
                onClick={() => onAct('approve')}
                disabled={acting}
                className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
              </button>
              <button
                onClick={() => onAct('request_changes')}
                disabled={acting || !decisionDraft.trim()}
                className="bg-orange-500/10 text-orange-400 border border-orange-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-orange-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                <AlertCircle className="w-3.5 h-3.5" /> Request changes
              </button>
              <button
                onClick={() => onAct('deny')}
                disabled={acting || !decisionDraft.trim()}
                className="bg-red-500/10 text-red-400 border border-red-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-red-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                <XCircle className="w-3.5 h-3.5" /> Deny
              </button>
            </div>
          </div>
        </>
      )}

      {inActiveLifecycle && (
        <div className="space-y-3">
          <div className="text-[11px] text-slate-400">
            Lifecycle actions on an <strong className="text-emerald-300">{prettyStatus(status).toLowerCase()}</strong> permit
            {expiresAt && (
              <> · expires <span className="font-mono text-slate-300">{new Date(expiresAt).toLocaleString()}</span></>
            )}
            {!expiresAt && status === 'approved' && (
              <> · <span className="italic">no expiration set</span></>
            )}
          </div>

          <textarea
            value={decisionDraft}
            onChange={(e) => setDecisionDraft(e.target.value)}
            placeholder="Reason — required for suspend / revoke / reinstate. Stored on the lifecycle timeline."
            rows={3}
            className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y"
          />

          <div className="flex items-center gap-2 flex-wrap">
            {status === 'approved' && (
              <button
                onClick={() => onAct('suspend')}
                disabled={acting || !decisionDraft.trim()}
                className="bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-yellow-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                <PauseCircle className="w-3.5 h-3.5" /> Suspend
              </button>
            )}
            {status === 'suspended' && (
              <button
                onClick={() => onAct('reinstate')}
                disabled={acting || !decisionDraft.trim()}
                className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                <PlayCircle className="w-3.5 h-3.5" /> Reinstate
              </button>
            )}
            <button
              onClick={() => onAct('revoke')}
              disabled={acting || !decisionDraft.trim()}
              className="bg-rose-500/10 text-rose-300 border border-rose-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-rose-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              <Ban className="w-3.5 h-3.5" /> Revoke (terminal)
            </button>
          </div>

          <div className="border-t border-slate-800/60 pt-3">
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
              Set / change expiration
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="datetime-local"
                value={expiresDraft}
                onChange={(e) => setExpiresDraft(e.target.value)}
                className="flex-1 bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              <button
                onClick={() => onAct('set_expiration')}
                disabled={acting || !expiresDraft.trim()}
                className="bg-slate-800/60 text-slate-200 border border-slate-700/50 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                <CalendarClock className="w-3.5 h-3.5" /> Save
              </button>
            </div>
            <p className="text-[10px] text-slate-600 mt-1">
              The scheduled sweep auto-expires permits whose expiration has passed (every 5 min). Cleared by submitting an empty value via API.
            </p>
          </div>
        </div>
      )}
    </Section>
  );
}

function SubmitterActions({ submission, acting, onWithdraw, onResubmit }: {
  submission: Record<string, unknown>;
  acting: boolean;
  onWithdraw: () => void;
  onResubmit: () => void;
}) {
  const status = submission.status as string;

  // Pre-decision: can withdraw.
  const canWithdraw = ['submitted', 'under_review', 'changes_requested'].includes(status);
  // After non-success terminal state: can chain a fresh submission off this one.
  const canResubmit = ['denied', 'changes_requested', 'withdrawn', 'expired', 'revoked'].includes(status);

  if (!canWithdraw && !canResubmit) return null;

  return (
    <Section icon={<RotateCcw className="w-4 h-4" />} title="Your actions">
      <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        {canWithdraw && (
          <button
            onClick={onWithdraw}
            disabled={acting}
            className="text-xs font-bold text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1.5"
          >
            <EyeOff className="w-3.5 h-3.5" /> Withdraw submission
          </button>
        )}
        {canResubmit && (
          <button
            onClick={onResubmit}
            disabled={acting}
            className="bg-amber-500/10 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Resubmit with changes
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        {canWithdraw && 'Removes from the authority\'s queue. '}
        {canResubmit && 'Resubmit chains the new submission to this one for context.'}
      </p>
      </div>
    </Section>
  );
}

function ProjectPayload({ project, calculations }: { project: Record<string, unknown>; calculations: Array<Record<string, unknown>> }) {
  const latestByType = calculations.reduce((acc, c) => {
    const t = c.calc_type as string;
    if (!acc[t]) acc[t] = c;
    return acc;
  }, {} as Record<string, Record<string, unknown>>);

  return (
    <Section icon={<FileText className="w-4 h-4" />} title="Project payload (full visibility)" accent="violet">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Address</div>
          <div className="text-slate-300">{[project.address, project.city, project.state, project.zip].filter(Boolean).join(', ') || '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Standard</div>
          <div className="font-mono text-slate-300">{(project.standard as string) ?? 'ACCA'}</div>
        </div>
        {project.climate_zone != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Climate zone</div>
            <div className="font-mono text-slate-300">{project.climate_zone as string}</div>
          </div>
        )}
      </div>

      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Latest calculations on file</div>
      {Object.keys(latestByType).length === 0 ? (
        <p className="text-xs text-slate-500 italic">No calculations have been persisted to D1 yet.</p>
      ) : (
        <div className="space-y-1">
          {(Object.entries(latestByType) as Array<[string, Record<string, unknown>]>).map(([t, c]) => (
            <div key={t} className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/40">
              <span className="font-bold text-white">{t}</span>
              <span className="text-slate-500 font-mono text-[10px]">v{c.version as number} · {c.engine_version as string}</span>
              <span className="text-slate-500 text-[10px]">{c.computed_at ? new Date(c.computed_at as string).toLocaleDateString() : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function CommentThread({ comments, sessionUserId, isAuthority, showInternal, setShowInternal, draft, setDraft, internalDraft, setInternalDraft, onPost, posting }: {
  comments: DetailData['comments'];
  sessionUserId: string | null;
  isAuthority: boolean;
  showInternal: boolean; setShowInternal: (b: boolean) => void;
  draft: string; setDraft: (s: string) => void;
  internalDraft: boolean; setInternalDraft: (b: boolean) => void;
  onPost: () => void;
  posting: boolean;
}) {
  const visible = comments.filter(c => showInternal || !c.is_internal);
  const internalCount = comments.filter(c => c.is_internal).length;

  return (
    <Section
      icon={<MessageSquare className="w-4 h-4" />}
      title={`Discussion (${visible.length})`}
      accent="amber"
      action={
        isAuthority && internalCount > 0 ? (
          <button
            onClick={() => setShowInternal(!showInternal)}
            className="text-[10px] font-mono text-slate-400 hover:text-amber-300 transition-colors"
          >
            {showInternal ? 'Hide' : 'Show'} {internalCount} internal
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3 mb-4">
        {visible.length === 0 ? (
          <p className="text-xs text-slate-500 italic px-3 py-4">No discussion yet.</p>
        ) : (
          visible.map((c) => {
            const isMine = c.author_user_id === sessionUserId;
            const author = [c.author_first_name, c.author_last_name].filter(Boolean).join(' ') || 'A user';
            return (
              <div key={c.id} className={`glass-panel rounded-xl border p-4 ${c.is_internal ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-800/60'}`}>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-bold text-white">{author}</span>
                    {c.author_is_authority === 1 && (
                      <AuthorityBadge variant="compact" />
                    )}
                    {c.author_org_name && <span className="text-slate-500">· {c.author_org_name}</span>}
                    {c.is_internal === 1 && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">Internal</span>
                    )}
                    {isMine && <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">you</span>}
                  </div>
                  <span className="text-[10px] text-slate-600 font-mono">
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-slate-300 whitespace-pre-wrap">{c.body}</p>
              </div>
            );
          })
        )}
      </div>

      <div className="glass-panel rounded-xl border border-slate-800/60 p-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add to the discussion…"
          rows={3}
          className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y"
        />
        <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-600">{draft.length} / 5000</span>
            {isAuthority && (
              <label className="text-[10px] text-slate-500 flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={internalDraft}
                  onChange={(e) => setInternalDraft(e.target.checked)}
                  className="accent-amber-500"
                />
                Internal note (only authority side sees this)
              </label>
            )}
          </div>
          <button
            onClick={onPost}
            disabled={posting || !draft.trim() || draft.length > 5000}
            className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" /> {posting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </div>
    </Section>
  );
}
