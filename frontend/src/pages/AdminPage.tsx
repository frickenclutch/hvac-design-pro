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
 *  - Organisations: full table with drill-down panel
 *  - Audit: recent cross-org events
 *  - Action Lab: empty placeholder — Unit 3+ endpoints land here as buttons
 */

import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  ShieldCheck, Activity, Building2, Users, FlaskConical, ChevronRight,
  RefreshCw, Cloud, AlertTriangle, Search, Eye, EyeOff,
} from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { api } from '../lib/api';

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

export default function AdminPage() {
  const user = useAuthStore((s) => s.user);

  // Hard gate — render-time check. Server still enforces 403 if bypassed.
  if (!user) return <Navigate to="/" replace />;
  if (!user.isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="px-4 py-6 md:p-8 md:pt-12 h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Platform Admin</h1>
            <p className="text-slate-400 text-sm">
              Cross-tenant control panel — visible only to L0 platform admins.
            </p>
          </div>
        </div>
        <div className="text-xs text-slate-600 font-mono">
          Signed in as <span className="text-amber-400">{user.email}</span>
        </div>
      </header>

      <div className="space-y-8 pb-20">
        <MetricsSection />
        <OrgsSection />
        <AuditSection />
        <ActionLabSection />
      </div>
    </div>
  );
}

// ── Metrics ──────────────────────────────────────────────────────────────────
function MetricsSection() {
  const [state, refresh] = useLoad(() => api.platformMetrics());

  return (
    <SectionShell
      icon={<Activity className="w-4 h-4" />}
      title="Platform metrics"
      subtitle="Cross-tenant totals + last-30-day activity"
      onRefresh={refresh}
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

// ── Organisations ────────────────────────────────────────────────────────────
function OrgsSection() {
  const [state, refresh] = useLoad(() => api.platformOrgs());
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
      onRefresh={refresh}
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
  const [state, refresh] = useLoad(() => api.platformOrgDetail(id), [id]);

  return (
    <div className="mt-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold text-amber-400 text-sm flex items-center gap-2">
          <Users className="w-4 h-4" /> Org detail
        </h4>
        <div className="flex items-center gap-2">
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

          <h5 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2">
            Members ({state.data.users.length})
          </h5>
          <div className="space-y-1">
            {state.data.users.map((u) => (
              <div
                key={u.id as string}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/40 text-xs"
              >
                <div className="flex-1">
                  <span className="font-bold text-slate-200">{u.first_name} {u.last_name}</span>
                  <span className="text-slate-500 ml-2 font-mono">{u.email as string}</span>
                </div>
                <span className="text-slate-500">{u.role as string}</span>
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
              </div>
            ))}
          </div>

          <RawJsonDrawer payload={state.data} />
        </>
      )}
    </div>
  );
}

// ── Audit ────────────────────────────────────────────────────────────────────
function AuditSection() {
  const [state, refresh] = useLoad(() => api.platformAudit(50));

  return (
    <SectionShell
      icon={<Activity className="w-4 h-4" />}
      title="Audit feed"
      subtitle="Most recent cross-org events (last 50)"
      onRefresh={refresh}
      loading={state.status === 'loading'}
    >
      {state.status === 'error' && <ErrorBlock message={state.message} />}
      {state.status === 'ok' && (
        <>
          {state.data.events.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              No audit events recorded yet. Audit writes land in a future unit.
            </p>
          ) : (
            <div className="space-y-1">
              {state.data.events.map((e, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/40 text-xs">
                  <span className="text-slate-500 font-mono w-32 truncate">
                    {new Date(e.created_at as string).toLocaleString()}
                  </span>
                  <span className="font-bold text-slate-200 w-32 truncate">{e.action as string}</span>
                  <span className="text-slate-400 truncate">{(e.org_name as string) ?? (e.org_id as string)}</span>
                </div>
              ))}
            </div>
          )}
          <RawJsonDrawer payload={state.data} />
        </>
      )}
    </SectionShell>
  );
}

// ── Action Lab ───────────────────────────────────────────────────────────────
function ActionLabSection() {
  return (
    <SectionShell
      icon={<FlaskConical className="w-4 h-4" />}
      title="Action lab"
      subtitle="Smoke-test surface for new endpoints — Unit 3+ buttons land here"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ActionPlaceholder
          name="Domain claim"
          unit="Unit 3"
          desc="Claim @yourdomain.com via TXT proof or email loop"
        />
        <ActionPlaceholder
          name="Subdivision tree"
          unit="Unit 3"
          desc="Declare child orgs (DBAs, subsidiaries) under parent tenant"
        />
        <ActionPlaceholder
          name="Reparent user"
          unit="Unit 3"
          desc="Tenant owner pulls a fragmented user into their tenant"
        />
        <ActionPlaceholder
          name="Issue invite"
          unit="Unit 5"
          desc="Send role-bound invite + email magic link"
        />
        <ActionPlaceholder
          name="Submit for review"
          unit="Unit 8"
          desc="Push project to a code-enforcer authority inbox"
        />
        <ActionPlaceholder
          name="Impersonate org"
          unit="Unit 11"
          desc="Issue scoped token to view a tenant as their admin"
        />
      </div>
    </SectionShell>
  );
}

// ── Reusable bits ────────────────────────────────────────────────────────────
function SectionShell({
  icon, title, subtitle, onRefresh, loading, children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-2xl border border-slate-800/60 p-5">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-slate-800/60 flex items-center justify-center text-amber-400">
            {icon}
          </div>
          <div>
            <h2 className="font-bold text-white text-base">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-800/60 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
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

function ActionPlaceholder({ name, unit, desc }: { name: string; unit: string; desc: string }) {
  return (
    <div className="rounded-xl bg-slate-900/40 border border-slate-800/40 border-dashed p-3 opacity-60">
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-sm text-slate-300">{name}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-500">{unit}</span>
      </div>
      <p className="text-[11px] text-slate-500">{desc}</p>
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
