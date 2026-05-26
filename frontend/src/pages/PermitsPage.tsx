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
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, ArrowLeft, RefreshCw, AlertTriangle, Clock,
  Building2, FileText, MessageSquare, Send, CheckCircle2,
  XCircle, AlertCircle, EyeOff, Eye, Hash, Activity,
  PauseCircle, PlayCircle, Ban, CalendarClock, History, RotateCcw,
} from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { api } from '../lib/api';
import AuthorityBadge from '../components/AuthorityBadge';
import EntityAuditModal from '../components/EntityAuditModal';
import { useAccessPolicyStore } from '../stores/useAccessPolicyStore';
import SubmitForReviewModal from '../features/permits/SubmitForReviewModal';
import type { Project } from '../features/projects/projectStorage';

type Status = 'submitted' | 'under_review' | 'approved' | 'denied'
  | 'changes_requested' | 'withdrawn'
  | 'suspended' | 'revoked' | 'expired';

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

export default function PermitsPage() {
  const { id } = useParams();
  if (id) return <PermitDetail id={id} />;
  return <PermitList />;
}

// ── List view ───────────────────────────────────────────────────────────────

function PermitList() {
  const isAuthority = useAuthStore((s) => !!s.user?.isPermitAuthority);
  const [items, setItems] = useState<ListedSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | ''>('');
  const navigate = useNavigate();

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.permitListSubmissions(statusFilter || undefined);
      setItems(r.submissions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [statusFilter]);

  // Authority-side counts: incoming queue (submitted), in-flight (under_review),
  // decided (approved/denied/changes). Helps the dashboard immediately convey
  // workload at a glance.
  const counts = items.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <ShieldCheck className="w-6 h-6 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-3xl font-bold text-white">Permits</h2>
              <p className="text-slate-400 text-sm">
                {isAuthority
                  ? 'Incoming submissions for your authority + your own outgoing submissions.'
                  : 'Permit submissions you have sent to authorities for review.'}
              </p>
            </div>
            {isAuthority && <AuthorityBadge title="Permit Authority" />}
          </div>
        </header>

        {/* Authority-only quick counts row */}
        {isAuthority && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
            {(['submitted', 'under_review', 'changes_requested', 'approved', 'denied', 'withdrawn'] as Status[]).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(statusFilter === st ? '' : st)}
                className={`rounded-xl border p-3 text-left transition-colors ${statusFilter === st
                  ? `${STATUS_PALETTE[st].bg} ${STATUS_PALETTE[st].border}`
                  : 'bg-slate-900/40 border-slate-800/40 hover:border-slate-700/60'}`}
              >
                <div className={`text-[10px] uppercase tracking-wider font-bold ${STATUS_PALETTE[st].text}`}>
                  {STATUS_PALETTE[st].label}
                </div>
                <div className="font-bold text-white tabular-nums text-2xl">
                  {counts[st] ?? 0}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Status | '')}
              className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-slate-200"
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_PALETTE).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs text-slate-400 hover:text-white px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-700/50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {err && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {err}
          </div>
        )}

        {!err && items.length === 0 && !loading && (
          <div className="glass-panel rounded-2xl border border-slate-800/60 p-10 text-center">
            <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">
              {isAuthority ? 'No submissions in your queue yet.' : 'You haven\'t submitted any projects for review.'}
            </p>
            {!isAuthority && (
              <p className="text-slate-500 text-xs mt-1">
                Go to your Dashboard and click the shield icon on a project to submit it for review.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          {items.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/permits/${s.id}`)}
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
                  {isAuthority && s.authority_org_id === useAuthStore.getState().organisation?.id
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
          ))}
        </div>
      </div>
    </div>
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
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <Link to="/permits" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-400">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Permits
          </Link>
          {/* Audit trail of every action on this submission — claim,
              decision, comments, status changes. Critical for legal
              defensibility of the permit decision itself. */}
          {canViewAudit && (
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-emerald-300 min-h-[36px]"
              title="Full audit trail for this permit submission"
            >
              <Activity className="w-3.5 h-3.5" />
              Activity
            </button>
          )}
        </div>

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

        {data && data.submission && (
          <SubmissionHeader submission={data.submission} project={data.project} />
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
    <div className="mb-6 glass-panel rounded-2xl border border-slate-800/60 p-5">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-violet-400" />
        <h3 className="font-bold text-white text-sm uppercase tracking-wider">
          Lifecycle ({transitions.length})
        </h3>
      </div>
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
    </div>
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

function SubmissionHeader({ submission, project }: { submission: Record<string, unknown>; project: Record<string, unknown> | null }) {
  const status = (submission.status as string) ?? 'submitted';
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
    <header className="mb-6 glass-panel rounded-2xl border border-slate-800/60 p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{(project?.name as string) || 'Untitled project'}</h1>
          <p className="text-sm text-slate-500">
            {[project?.address, project?.city, project?.state, project?.zip].filter(Boolean).join(', ') || 'No address'}
          </p>
        </div>
        <StatusChip status={status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-400 mb-3">
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
    </header>
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
    <div className="mb-6 glass-panel rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-amber-400" />
        <h3 className="font-bold text-amber-300 text-sm uppercase tracking-wider">Authority actions</h3>
      </div>

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
    </div>
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
    <div className="mb-6 glass-panel rounded-2xl border border-slate-800/60 p-4 flex items-center justify-between gap-3 flex-wrap">
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
  );
}

function ProjectPayload({ project, calculations }: { project: Record<string, unknown>; calculations: Array<Record<string, unknown>> }) {
  const latestByType = calculations.reduce((acc, c) => {
    const t = c.calc_type as string;
    if (!acc[t]) acc[t] = c;
    return acc;
  }, {} as Record<string, Record<string, unknown>>);

  return (
    <div className="mb-6 glass-panel rounded-2xl border border-slate-800/60 p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-violet-400" />
        <h3 className="font-bold text-white text-sm uppercase tracking-wider">Project payload (full visibility)</h3>
      </div>

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
    </div>
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
    <>
      <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2 flex-wrap">
        <MessageSquare className="w-4 h-4 text-amber-400" />
        Discussion ({visible.length})
        {isAuthority && internalCount > 0 && (
          <button
            onClick={() => setShowInternal(!showInternal)}
            className="ml-auto text-[10px] font-mono text-slate-500 hover:text-amber-400 transition-colors"
          >
            {showInternal ? 'Hide' : 'Show'} {internalCount} internal
          </button>
        )}
      </h2>

      <div className="space-y-3 mb-6">
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
    </>
  );
}
