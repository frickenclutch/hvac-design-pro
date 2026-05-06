/**
 * AuditLogView — shared component for the audit log feed.
 *
 * Used by:
 *  - /audit-log (tenant) — admin sees org-wide feed; non-admin sees own actions
 *  - /admin (L0)         — platform admin sees cross-tenant feed
 *  - Per-entity tabs     — drill-down history for one project / user / calc
 *
 * Modes:
 *  - scope='tenant'   — default; the tenant feed
 *  - scope='platform' — L0 only; cross-tenant feed with org filter
 *
 * Drill-through: clicking a row's entity badge opens the entity in its
 * native page (project → /dashboard, user → /team, permit → /permits/:id,
 * etc). Clicking the row body opens the detail drawer with full JSON.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ChevronRight, RefreshCw, Search, X,
  AlertTriangle, ShieldCheck, FileText, Users, Cpu, PenTool,
  MessageSquare, Globe, Building2, ExternalLink, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api, type AuditEvent, type AuditLogQuery } from '../lib/api';

interface Props {
  /** Tenant view shows actions involving caller's org. Platform view (L0
   *  only) shows everything. */
  scope: 'tenant' | 'platform';
  /** Pre-fill filter — useful when embedded in a per-entity tab. */
  initialFilters?: Partial<AuditLogQuery>;
  /** Show the org filter dropdown (only meaningful for L0 scope). */
  showOrgFilter?: boolean;
  /** When true, render compact (fewer columns) — used inside narrow panels. */
  compact?: boolean;
}

export default function AuditLogView({ scope, initialFilters, showOrgFilter, compact }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditLogQuery>({
    scope,
    limit: 100,
    ...initialFilters,
  });
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async (append = false) => {
    setLoading(true);
    setError(null);
    try {
      const q = append && nextCursor ? { ...filters, cursor: nextCursor } : filters;
      const res = await api.auditLog(q);
      setEvents((prev) => (append ? [...prev, ...res.events] : res.events));
      setNextCursor(res.nextCursor);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  // Initial + filter-driven load
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.scope, filters.userId, filters.entityType, filters.entityId,
      filters.projectId, filters.action, filters.orgId, filters.since]);

  // Load action list once for the dropdown
  useEffect(() => {
    api.auditLogActions(scope)
      .then((r) => setActions(r.actions))
      .catch(() => { /* non-fatal */ });
  }, [scope]);

  // Client-side text search across visible fields. Filtering by date range,
  // user, action goes to the server (URL params); free-text stays local so
  // filtering feels instant.
  const visible = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter((e) =>
      [
        e.action, e.actor.email, e.actor.firstName, e.actor.lastName,
        e.actor.orgName, e.target.orgName,
        e.entity.type, e.entity.label, e.path,
      ].some((v) => v?.toLowerCase().includes(q))
    );
  }, [events, search]);

  const setFilter = <K extends keyof AuditLogQuery>(k: K, v: AuditLogQuery[K]) => {
    setFilters((prev) => ({ ...prev, [k]: v || undefined }));
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, user, entity..."
            className="w-full pl-8 pr-2 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 min-h-[44px]"
          />
        </div>

        <select
          value={filters.action ?? ''}
          onChange={(e) => setFilter('action', e.target.value || undefined)}
          className="px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 min-h-[44px]"
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          value={filters.entityType ?? ''}
          onChange={(e) => setFilter('entityType', e.target.value || undefined)}
          className="px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 min-h-[44px]"
        >
          <option value="">All entities</option>
          <option value="project">Projects</option>
          <option value="user">Users</option>
          <option value="organisation">Organisation</option>
          <option value="calculation">Calculations</option>
          <option value="cad_drawing">CAD drawings</option>
          <option value="permit_submission">Permits</option>
          <option value="org_invite">Invites</option>
          <option value="file_upload">Files</option>
          <option value="project_comment">Comments</option>
          <option value="feedback">Feedback</option>
        </select>

        {showOrgFilter && (
          <input
            type="text"
            value={filters.orgId ?? ''}
            onChange={(e) => setFilter('orgId', e.target.value || undefined)}
            placeholder="Filter by org id"
            className="w-44 px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 min-h-[44px] font-mono"
          />
        )}

        <button
          onClick={() => void load(false)}
          disabled={loading}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 rounded-lg text-sm text-slate-200 flex items-center gap-1.5 min-h-[44px]"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {!compact && <span>Refresh</span>}
        </button>

        {(filters.action || filters.entityType || filters.userId || filters.orgId || filters.entityId || filters.projectId) && (
          <button
            onClick={() => setFilters({ scope, limit: 100 })}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 flex items-center gap-1.5 min-h-[44px]"
            title="Clear filters"
          >
            <X className="w-4 h-4" />
            {!compact && <span>Clear</span>}
          </button>
        )}
      </div>

      {/* Status indicators */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>{visible.length} event{visible.length === 1 ? '' : 's'}</span>
        {scope === 'platform' && <span className="text-amber-400">Cross-tenant view (L0)</span>}
        {scope === 'tenant' && <span>Your organisation only</span>}
        {nextCursor && <span className="text-slate-600">More available — click "Load more" below</span>}
      </div>

      {/* Event rows */}
      <div className="rounded-xl border border-slate-800/60 overflow-hidden">
        {visible.length === 0 && !loading && (
          <div className="p-8 text-center text-slate-500 text-sm">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No audit events match the current filters.
          </div>
        )}

        {visible.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            expanded={expandedId === e.id}
            onToggle={() => setExpandedId((prev) => prev === e.id ? null : e.id)}
            scope={scope}
            compact={compact}
          />
        ))}
      </div>

      {/* Pagination */}
      {nextCursor && (
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="w-full px-4 py-3 bg-slate-800/60 hover:bg-slate-800 disabled:opacity-50 border border-slate-700 rounded-lg text-sm text-slate-300 flex items-center justify-center gap-2 min-h-[44px]"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
          Load older events
        </button>
      )}
    </div>
  );
}

// ── Event row ──────────────────────────────────────────────────────────────

interface EventRowProps {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
  scope: 'tenant' | 'platform';
  compact?: boolean;
}

function EventRow({ event: e, expanded, onToggle, scope, compact }: EventRowProps) {
  const actor = formatActor(e.actor);
  const time = formatTime(e.createdAt);
  const statusColor =
    !e.statusCode ? 'text-slate-500' :
    e.statusCode >= 500 ? 'text-red-400' :
    e.statusCode >= 400 ? 'text-amber-400' :
    'text-emerald-400';

  return (
    <div className={`border-b border-slate-800/40 last:border-b-0 ${expanded ? 'bg-slate-900/40' : 'hover:bg-slate-900/20'} transition-colors`}>
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-start gap-3 text-left"
      >
        <ActionIcon action={e.action} />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-slate-200">{actor}</span>
            <span className="text-xs text-slate-500 font-mono">{e.action}</span>
            {e.actor.isPlatformAction && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                L0
              </span>
            )}
          </div>

          <div className="text-xs text-slate-400 mt-0.5 truncate">
            {e.entity.label
              ? <>on <span className="text-slate-300">{e.entity.label}</span></>
              : e.entity.type
                ? <>on <span className="text-slate-300">{e.entity.type}</span></>
                : null}
            {e.entity.id && (
              <span className="text-slate-600 font-mono ml-1">#{e.entity.id.slice(0, 8)}</span>
            )}
            {scope === 'platform' && e.actor.orgName && (
              <span className="text-slate-500 ml-2">{e.actor.orgName}</span>
            )}
            {e.target.orgName && e.target.orgId !== e.actor.orgId && (
              <span className="text-slate-500 ml-2">→ {e.target.orgName}</span>
            )}
          </div>
        </div>

        {!compact && (
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <span className="text-xs text-slate-500" title={e.createdAt as string}>{time}</span>
            <span className={`text-[10px] font-mono ${statusColor}`}>
              {e.method} {e.statusCode ?? '?'}
              {e.durationMs != null && <span className="text-slate-600 ml-1">{e.durationMs}ms</span>}
            </span>
          </div>
        )}

        {expanded
          ? <ChevronUp className="w-4 h-4 text-slate-500 mt-1 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-slate-500 mt-1 flex-shrink-0" />}
      </button>

      {expanded && <EventDetail event={e} />}
    </div>
  );
}

// ── Detail drawer ──────────────────────────────────────────────────────────

function EventDetail({ event: e }: { event: AuditEvent }) {
  const drillUrl = entityViewUrl(e);
  return (
    <div className="px-3 pb-3 pt-1 ml-9 space-y-3">
      {/* Drill-through */}
      <div className="flex flex-wrap items-center gap-2">
        {drillUrl && (
          <Link
            to={drillUrl}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-lg"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View {e.entity.type?.replace('_', ' ')}
          </Link>
        )}
        {e.entity.projectId && e.entity.type !== 'project' && (
          <Link
            to={`/project/${e.entity.projectId}/cad`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg"
          >
            <PenTool className="w-3.5 h-3.5" />
            Open project
          </Link>
        )}
      </div>

      {/* Identifying detail */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
        <Field label="Time" value={new Date(e.createdAt).toLocaleString()} />
        <Field label="Actor" value={formatActorFull(e.actor)} />
        <Field label="Role" value={e.actor.role ?? '—'} />
        <Field label="Method" value={`${e.method ?? '—'} ${e.statusCode ?? ''}`.trim()} />
        <Field label="Path" value={e.path ?? '—'} mono />
        <Field label="Duration" value={e.durationMs != null ? `${e.durationMs} ms` : '—'} />
        <Field label="IP" value={e.network.ip ?? '—'} mono />
        <Field label="Request id" value={e.network.requestId ?? '—'} mono />
        <Field label="Entity id" value={e.entity.id ?? '—'} mono />
      </div>

      {/* Before/after diff */}
      {(e.beforeValue || e.afterValue) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {e.beforeValue ? <JsonBlock label="Before" value={e.beforeValue} tone="muted" /> : null}
          {e.afterValue ? <JsonBlock label="After" value={e.afterValue} tone="active" /> : null}
        </div>
      ) : null}

      {/* Free-form detail */}
      {e.detail !== null && e.detail !== undefined && e.detail !== '' && (
        <JsonBlock label="Detail" value={e.detail} tone="neutral" />
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-600">{label}</span>
      <span className={`text-slate-300 truncate ${mono ? 'font-mono' : ''}`} title={value}>
        {value || '—'}
      </span>
    </div>
  );
}

function JsonBlock({ label, value, tone }: { label: string; value: unknown; tone: 'muted' | 'active' | 'neutral' }) {
  const tones = {
    muted: 'border-slate-700/60 bg-slate-900/40 text-slate-400',
    active: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200',
    neutral: 'border-slate-700/60 bg-slate-900/40 text-slate-300',
  };
  let pretty: string;
  try {
    pretty = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <div className={`rounded-lg border p-2 ${tones[tone]}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">{label}</div>
      <pre className="text-xs whitespace-pre-wrap break-all font-mono leading-snug max-h-64 overflow-y-auto">
        {pretty}
      </pre>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatActor(a: AuditEvent['actor']): string {
  if (a.firstName || a.lastName) return `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
  return a.email ?? 'Unknown user';
}

function formatActorFull(a: AuditEvent['actor']): string {
  const name = formatActor(a);
  return a.email && a.email !== name ? `${name} (${a.email})` : name;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const ms = now - d.getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  if (ms < 86_400_000 * 7) return `${Math.floor(ms / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

function ActionIcon({ action }: { action: string }) {
  const cls = 'w-4 h-4 mt-0.5 flex-shrink-0';
  if (action.startsWith('user.')) return <Users className={`${cls} text-cyan-400`} />;
  if (action.startsWith('org.')) return <Building2 className={`${cls} text-cyan-400`} />;
  if (action.startsWith('project.share') || action.startsWith('project.comment')) return <Globe className={`${cls} text-violet-400`} />;
  if (action.startsWith('project.')) return <FileText className={`${cls} text-emerald-400`} />;
  if (action.startsWith('cad_drawing.')) return <PenTool className={`${cls} text-emerald-400`} />;
  if (action.startsWith('calculation.')) return <Cpu className={`${cls} text-yellow-400`} />;
  if (action.startsWith('permit.')) return <ShieldCheck className={`${cls} text-amber-400`} />;
  if (action.startsWith('feedback.')) return <MessageSquare className={`${cls} text-pink-400`} />;
  if (action.startsWith('file.')) return <FileText className={`${cls} text-slate-400`} />;
  if (action.startsWith('api.')) return <Activity className={`${cls} text-slate-500`} />;
  return <ChevronRight className={`${cls} text-slate-500`} />;
}

/** Best-effort routing from an audit row to the entity's home in the app. */
function entityViewUrl(e: AuditEvent): string | null {
  const t = e.entity.type;
  const id = e.entity.id;
  if (!t || !id) return null;
  switch (t) {
    case 'project':
      return `/project/${id}/cad`;
    case 'cad_drawing':
      return e.entity.projectId ? `/project/${e.entity.projectId}/cad` : null;
    case 'calculation':
      return e.entity.projectId ? `/project/${e.entity.projectId}/cad` : null;
    case 'permit_submission':
      return `/permits/${id}`;
    case 'user':
      return '/team';
    case 'organisation':
      return '/settings';
    case 'org_invite':
      return '/team';
    case 'project_comment':
      return e.entity.projectId ? `/community/${e.entity.projectId}` : '/community';
    default:
      return null;
  }
}
