/**
 * Team — tenant member management.
 *
 * Visible to every authenticated user; mutations gated on role = 'admin'.
 * Non-admins see a read-only roster + the org's claimed domain.
 *
 * The L0 platform admin can do all of this for ANY tenant via the Admin
 * panel's Org-detail drawer; this page is the L1 admin's instrument for
 * their own tenant.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, UserPlus, Globe, Mail, Trash2, Shield, RefreshCw,
  AlertTriangle, CheckCircle2, Copy, Crown, ShieldCheck, Activity, RotateCcw,
  Building2, ArrowRightLeft,
} from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { api } from '../lib/api';
import AuthorityBadge from '../components/AuthorityBadge';
import EntityAuditModal from '../components/EntityAuditModal';

type Role = 'admin' | 'engineer' | 'tech' | 'viewer';

interface Member {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: Role;
  is_verified: number;
  is_permit_authority?: number;
  last_seen_at: string | null;
  created_at: string;
  status?: 'active' | 'deactivated';
}

interface Invite {
  id: string;
  invited_email: string;
  invited_role: string;
  status: string;
  invited_by: string;
  expires_at: string;
  created_at: string;
  /** Raw redemption token — what /onboarding?invite= actually looks up.
   *  Returned by GET /api/org/team; the row `id` deliberately is NOT usable
   *  in the link (redeem matches WHERE token = ?). */
  token: string;
  /** 'new_user' = classic signup invite; 'reparent' = account-transfer
   *  request the target user accepts/declines in-app (no redeem link). */
  kind: 'new_user' | 'reparent';
}

type Subdivision = Awaited<ReturnType<typeof api.teamSubdivisions>>['subdivisions'][number];

const ROLES: Role[] = ['admin', 'engineer', 'tech', 'viewer'];

export default function TeamPage() {
  const sessionUser = useAuthStore((s) => s.user);
  const orgName = useAuthStore((s) => s.organisation?.name);

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [domain, setDomain] = useState<{ claimed: string | null; verifiedAt: string | null }>({ claimed: null, verifiedAt: null });
  const [subdivisions, setSubdivisions] = useState<Subdivision[]>([]);
  const [parentOrg, setParentOrg] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Per-member activity modal — set to the member object you want to audit,
  // null when closed. Admin-only; non-admins see their own history via
  // the global /audit-log page instead.
  const [auditTarget, setAuditTarget] = useState<Member | null>(null);

  // Pre-flight resolution gate. Holds the proposed change + its computed
  // blockers when a role change / deactivation has consequences that must
  // be acknowledged or resolved before commit. null = no gate open
  // (the common, frictionless path).
  type PreflightPlan = Awaited<ReturnType<typeof api.teamRoleChangePreflight>>;
  const [gate, setGate] = useState<
    { userId: string; email: string; proposedRole: Role | null; plan: PreflightPlan } | null
  >(null);

  // Run a role change (proposedRole) or deactivation (proposedRole=null)
  // through preflight. No blockers → commit transparently (zero added
  // friction for the 95% case). Blockers → open the resolution gate.
  const attemptChange = async (userId: string, email: string, proposedRole: Role | null) => {
    setErr(null);
    try {
      const plan = await api.teamRoleChangePreflight(userId, proposedRole);
      if (plan.blockers.length === 0) {
        await commitChange(userId, proposedRole);
        return;
      }
      setGate({ userId, email, proposedRole, plan });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      refresh(); // snap the role dropdown back to actual state
    }
  };

  const commitChange = async (userId: string, proposedRole: Role | null) => {
    try {
      if (proposedRole === null) {
        await api.teamRemoveMember(userId);
        setInfo('Member deactivated. Access revoked; data preserved.');
      } else {
        await api.teamSetRole(userId, proposedRole);
        setInfo('Role updated.');
      }
      setGate(null);
      refresh();
    } catch (e) {
      // Race: state changed between preflight and commit → surface the
      // server's authoritative blockers.
      setErr(e instanceof Error ? e.message : String(e));
      setGate(null);
      refresh();
    }
  };

  const isAdmin = sessionUser?.role === 'admin';

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [data, subs] = await Promise.all([
        api.teamList(),
        api.teamSubdivisions().catch(() => null), // tolerate pre-migration worker
      ]);
      setMembers(data.members);
      setInvites(data.invites);
      setDomain(data.domain);
      if (subs) {
        setSubdivisions(subs.subdivisions);
        setParentOrg(subs.parent);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <Users className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-3xl font-bold text-white">Team</h2>
              <p className="text-slate-400 text-sm">
                {orgName ? `${orgName} · ` : ''}members of your organisation
                {parentOrg && (
                  <span className="text-slate-500"> · subdivision of <span className="text-slate-300">{parentOrg.name}</span></span>
                )}
              </p>
            </div>
            <Link
              to="/audit-log"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-slate-700 text-sm text-slate-300 hover:text-emerald-300 transition-colors min-h-[44px]"
              title="See every action taken by anyone in your organisation"
            >
              <Activity className="w-4 h-4" />
              <span className="hidden md:inline">Audit log</span>
            </Link>
          </div>
          {!isAdmin && (
            <p className="text-xs text-slate-500 mt-3">
              You're viewing as {sessionUser?.role}. Ask an admin in your tenant to invite or remove members.
            </p>
          )}
        </header>

        {err && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {err}
          </div>
        )}
        {info && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {info}
          </div>
        )}

        <div className="space-y-6">
          <DomainCard
            domain={domain}
            isAdmin={isAdmin}
            onUpdate={async (next) => {
              try {
                const r = await api.teamSetDomain(next);
                setDomain({ claimed: r.domain, verifiedAt: r.verifiedAt });
                setInfo(next ? `Claimed @${next}` : 'Domain claim removed');
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            }}
          />

          {isAdmin && (
            <InviteCard
              defaultDomain={domain.claimed}
              subdivisions={subdivisions}
              onInvite={async (email, role, subdivisionId) => {
                try {
                  const r = await api.teamInvite(email, role, subdivisionId);
                  // Surface email delivery status — a green message means
                  // the recipient should already see the invitation in
                  // their inbox; a yellow message means delivery failed
                  // and the admin should copy the link manually.
                  if (r.emailSent) {
                    setInfo(`Invitation emailed to ${email}.`);
                  } else {
                    setInfo(
                      `Invite created for ${email}, but email delivery failed${r.emailError ? ` (${r.emailError})` : ''}. Use the copy button below to share the link manually.`
                    );
                  }
                  refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          )}

          {isAdmin && (
            <TransferCard
              onRequest={async (email, role) => {
                try {
                  const r = await api.teamReparent(email, role);
                  setInfo(
                    r.emailSent
                      ? `Transfer request sent to ${email} — they'll see it in-app and by email.`
                      : `Transfer request created for ${email}. Email delivery failed — they'll still see it in-app on their next sign-in.`
                  );
                  refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          )}

          {/* Subdivisions — hidden for orgs that are themselves a subdivision
              (single-level tree) */}
          {!parentOrg && (
            <SubdivisionsCard
              subdivisions={subdivisions}
              isAdmin={isAdmin}
              onCreate={async (name) => {
                try {
                  await api.teamCreateSubdivision(name);
                  setInfo(`Subdivision "${name}" created. Invite its first admin from the invite card above.`);
                  refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
              onDelete={async (sub) => {
                if (!confirm(`Remove the empty subdivision "${sub.name}"?`)) return;
                try {
                  await api.teamDeleteSubdivision(sub.id);
                  setInfo(`Subdivision "${sub.name}" removed.`);
                  refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          )}

          <PendingInvitesCard
            invites={invites}
            isAdmin={isAdmin}
            onRevoke={async (id) => {
              try {
                await api.teamRevokeInvite(id);
                setInfo('Invite revoked.');
                refresh();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            }}
            onCopy={(token) => {
              const url = `${window.location.origin}/onboarding?invite=${token}`;
              navigator.clipboard.writeText(url).then(
                () => setInfo('Redemption link copied to clipboard.'),
                () => setErr('Could not copy to clipboard.'),
              );
            }}
          />

          <MembersCard
            members={members}
            sessionUserId={sessionUser?.id ?? null}
            isAdmin={isAdmin}
            loading={loading}
            onRefresh={refresh}
            onSetRole={(userId, role) => {
              const m = members.find((x) => x.id === userId);
              if (!m || m.role === role) return;
              void attemptChange(userId, m.email, role);
            }}
            onSetAuthority={async (userId, isAuth) => {
              try {
                await api.teamSetAuthorityFlag(userId, isAuth);
                setInfo(isAuth ? 'Authority flag enabled.' : 'Authority flag removed.');
                refresh();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            }}
            onRemove={(userId) => {
              const m = members.find((x) => x.id === userId);
              if (!m) return;
              // Preflight first. If clean, it still confirms (deactivation
              // is consequential); if blockers, the gate modal handles it.
              void (async () => {
                try {
                  const plan = await api.teamRoleChangePreflight(userId, null);
                  if (plan.blockers.length === 0) {
                    if (!confirm('Deactivate this member? They lose access immediately and their live sessions are revoked. Their projects, calcs and history are preserved, and you can reactivate them later.')) return;
                    await commitChange(userId, null);
                  } else {
                    setGate({ userId, email: m.email, proposedRole: null, plan });
                  }
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              })();
            }}
            onReactivate={async (userId) => {
              try {
                await api.teamReactivateMember(userId);
                setInfo('Member reactivated.');
                refresh();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            }}
            onViewActivity={(member) => setAuditTarget(member)}
          />

          <EntityAuditModal
            isOpen={!!auditTarget}
            onClose={() => setAuditTarget(null)}
            entityType="user"
            entityId={auditTarget?.id ?? ''}
            label={
              auditTarget
                ? ([auditTarget.first_name, auditTarget.last_name].filter(Boolean).join(' ') || auditTarget.email)
                : ''
            }
            context={auditTarget?.email}
          />

          {gate && (
            <RoleChangeGate
              email={gate.email}
              proposedRole={gate.proposedRole}
              blockers={gate.plan.blockers}
              onCancel={() => { setGate(null); refresh(); }}
              onConfirm={() => void commitChange(gate.userId, gate.proposedRole)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Role-change resolution gate ─────────────────────────────────────────────
// The "fill the gap before proceeding" surface. Only shown when preflight
// returned blockers (the clean path passes through with zero friction).
// 'block' items are hard stops with actionable guidance (Confirm stays
// disabled); 'warn' items each need an explicit acknowledgement.
function RoleChangeGate({ email, proposedRole, blockers, onCancel, onConfirm }: {
  email: string;
  proposedRole: Role | null;
  blockers: Array<{ code: string; severity: 'block' | 'warn'; message: string; count?: number }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const blocks = blockers.filter((b) => b.severity === 'block');
  const warns = blockers.filter((b) => b.severity === 'warn');
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const allWarnsAcked = warns.every((w) => acked[w.code]);
  const canConfirm = blocks.length === 0 && allWarnsAcked;
  const actionLabel = proposedRole === null ? 'Deactivate' : `Change role to ${proposedRole}`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-lg bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-slate-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-white">Resolve before proceeding</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {actionLabel} · <span className="font-mono">{email}</span>
            </p>
          </div>
        </header>

        <div className="px-5 py-4 space-y-3 max-h-[55vh] overflow-y-auto">
          {blocks.length > 0 && (
            <div className="space-y-2">
              {blocks.map((b) => (
                <div key={b.code} className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
                  <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 flex-shrink-0 mt-0.5">Blocked</span>
                  <p className="text-sm text-red-200">{b.message}</p>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                Blocked items must be fixed first (e.g. promote another admin), then reopen this change.
              </p>
            </div>
          )}

          {warns.map((w) => (
            <label key={w.code} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 cursor-pointer">
              <input
                type="checkbox"
                checked={!!acked[w.code]}
                onChange={(e) => setAcked((s) => ({ ...s, [w.code]: e.target.checked }))}
                className="mt-0.5 accent-amber-400"
              />
              <span className="text-sm text-amber-100">
                {w.message}
                <span className="block text-[11px] text-slate-500 mt-0.5">I understand and want to proceed.</span>
              </span>
            </label>
          ))}
        </div>

        <footer className="px-5 py-3 border-t border-slate-800 bg-slate-900/40 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-300 min-h-[40px]">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed min-h-[40px]"
          >
            {actionLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({ icon, title, subtitle, action, children }: { icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-2xl border border-slate-800/60 p-5">
      <header className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-slate-800/60 flex items-center justify-center text-emerald-400">
            {icon}
          </div>
          <div>
            <h3 className="font-bold text-white text-base">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function DomainCard({ domain, isAdmin, onUpdate }: { domain: { claimed: string | null; verifiedAt: string | null }; isAdmin: boolean; onUpdate: (d: string) => void }) {
  const [draft, setDraft] = useState(domain.claimed ?? '');
  useEffect(() => { setDraft(domain.claimed ?? ''); }, [domain.claimed]);

  return (
    <Section
      icon={<Globe className="w-4 h-4" />}
      title="Claimed email domain"
      subtitle="Optional — links new signups at this domain into your tenant"
    >
      {!isAdmin ? (
        <p className="text-sm text-slate-400">
          {domain.claimed
            ? <>Your tenant claims <span className="font-mono text-emerald-400">@{domain.claimed}</span>.</>
            : 'No domain claimed.'}
        </p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-500 font-mono text-sm">@</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toLowerCase())}
            placeholder="example.com"
            className="flex-1 min-w-[12rem] bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <button
            onClick={() => onUpdate(draft.trim())}
            className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all"
          >
            {draft.trim() === (domain.claimed ?? '') ? 'No change' : 'Save'}
          </button>
          {domain.claimed && (
            <button
              onClick={() => onUpdate('')}
              className="text-slate-500 hover:text-red-400 text-xs font-bold uppercase tracking-wider px-2 py-2"
            >
              Clear
            </button>
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-3">
        {domain.verifiedAt
          ? <>Verified <span className="font-mono">{new Date(domain.verifiedAt).toLocaleDateString()}</span></>
          : domain.claimed
            ? 'Claimed but not yet verified — DNS TXT verification flow ships in Phase 2.'
            : 'Tenants without a claimed domain can still invite members one-by-one.'}
      </p>
    </Section>
  );
}

function InviteCard({ defaultDomain, subdivisions, onInvite }: {
  defaultDomain: string | null;
  subdivisions: Subdivision[];
  onInvite: (email: string, role: Role, subdivisionId?: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('tech');
  // '' = this org; otherwise a child org id. Only rendered when the tenant
  // has declared subdivisions.
  const [target, setTarget] = useState('');

  return (
    <Section
      icon={<UserPlus className="w-4 h-4" />}
      title="Invite a member"
      subtitle={defaultDomain ? `Suggested: someone@${defaultDomain}` : 'Email + role'}
    >
      <div className="flex flex-col md:flex-row gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={defaultDomain ? `someone@${defaultDomain}` : 'someone@example.com'}
          className="flex-1 bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {subdivisions.length > 0 && (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            title="Which organisation the member joins"
          >
            <option value="">This organisation</option>
            {subdivisions.map((s) => <option key={s.id} value={s.id}>↳ {s.name}</option>)}
          </select>
        )}
        <button
          onClick={() => {
            if (!email.trim()) return;
            onInvite(email.trim(), role, target || undefined);
            setEmail('');
          }}
          className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all flex items-center gap-1.5"
        >
          <Mail className="w-3.5 h-3.5" /> Send invite
        </button>
      </div>
      <p className="text-[11px] text-slate-500 mt-3">
        The invited address gets an email with a one-click acceptance link. If delivery fails (corporate filter, typo'd domain) use the copy button in the pending list to share the link manually.
        {subdivisions.length > 0 && ' A subdivision’s first member must be an admin.'}
      </p>
    </Section>
  );
}

function TransferCard({ onRequest }: { onRequest: (email: string, role: Role) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('tech');

  return (
    <Section
      icon={<ArrowRightLeft className="w-4 h-4" />}
      title="Bring in an existing account"
      subtitle="For someone who already registered solo — moves their account here with their consent"
    >
      <div className="flex flex-col md:flex-row gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their-registered@email.com"
          className="flex-1 bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button
          onClick={() => {
            if (!email.trim()) return;
            onRequest(email.trim(), role);
            setEmail('');
          }}
          className="bg-sky-500/10 text-sky-400 border border-sky-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-sky-500/20 transition-all flex items-center gap-1.5"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" /> Request transfer
        </button>
      </div>
      <p className="text-[11px] text-slate-500 mt-3">
        Nothing moves until they accept in-app. Their account transfers; their existing projects stay in their old workspace. Only accounts that are the sole member of their own organisation can be transferred — anything else goes through platform support.
      </p>
    </Section>
  );
}

function SubdivisionsCard({ subdivisions, isAdmin, onCreate, onDelete }: {
  subdivisions: Subdivision[];
  isAdmin: boolean;
  onCreate: (name: string) => void;
  onDelete: (sub: Subdivision) => void;
}) {
  const [name, setName] = useState('');

  return (
    <Section
      icon={<Building2 className="w-4 h-4" />}
      title={`Subdivisions (${subdivisions.length})`}
      subtitle="Child organisations — DBAs, subsidiaries, branch offices — under this tenant"
    >
      {subdivisions.length === 0 ? (
        <p className="text-xs text-slate-500 italic mb-3">No subdivisions declared.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {subdivisions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/40 text-sm flex-wrap">
              <Building2 className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="font-bold text-slate-200 flex-1 truncate">{s.name}</span>
              <span className="text-[10px] text-slate-500 font-mono">{s.user_count} member{s.user_count === 1 ? '' : 's'}</span>
              <span className="text-[10px] text-slate-500 font-mono">{s.project_count} project{s.project_count === 1 ? '' : 's'}</span>
              {s.pending_invite_count > 0 && (
                <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">
                  {s.pending_invite_count} invite{s.pending_invite_count === 1 ? '' : 's'} pending
                </span>
              )}
              {isAdmin && s.user_count === 0 && s.project_count === 0 && (
                <button
                  onClick={() => onDelete(s)}
                  className="text-slate-400 hover:text-red-400 text-xs font-bold flex items-center gap-1"
                  title="Remove empty subdivision"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Subdivision name — e.g. Howland Pump — Potsdam"
            className="flex-1 bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <button
            onClick={() => {
              const n = name.trim();
              if (n.length < 2) return;
              onCreate(n);
              setName('');
            }}
            className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all"
          >
            Declare subdivision
          </button>
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-3">
        Each subdivision is a full workspace with its own members and projects. Staff it via the invite card above (choose the subdivision as the destination); its first member must be an admin. Only empty subdivisions can be removed.
      </p>
    </Section>
  );
}

function PendingInvitesCard({ invites, isAdmin, onRevoke, onCopy }: { invites: Invite[]; isAdmin: boolean; onRevoke: (id: string) => void; onCopy: (token: string) => void }) {
  return (
    <Section icon={<Mail className="w-4 h-4" />} title={`Pending invites (${invites.length})`}>
      {invites.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No pending invites.</p>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/40 text-sm flex-wrap">
              <span className="font-mono text-slate-200 flex-1 truncate">{inv.invited_email}</span>
              {inv.kind === 'reparent' && (
                <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400" title="Account-transfer request — the user accepts or declines in-app">
                  Transfer
                </span>
              )}
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-2 py-0.5 rounded bg-slate-800/60">{inv.invited_role}</span>
              <span className="text-[10px] text-slate-600 font-mono">expires {new Date(inv.expires_at).toLocaleDateString()}</span>
              {isAdmin && (
                <>
                  {inv.kind !== 'reparent' && (
                    <button
                      onClick={() => onCopy(inv.token)}
                      className="text-slate-400 hover:text-emerald-400 text-xs font-bold flex items-center gap-1"
                      title="Copy redemption link"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => onRevoke(inv.id)}
                    className="text-slate-400 hover:text-red-400 text-xs font-bold flex items-center gap-1"
                    title="Revoke invite"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function MembersCard({ members, sessionUserId, isAdmin, loading, onRefresh, onSetRole, onSetAuthority, onRemove, onReactivate, onViewActivity }: {
  members: Member[]; sessionUserId: string | null; isAdmin: boolean; loading: boolean;
  onRefresh: () => void;
  onSetRole: (userId: string, role: Role) => void;
  onSetAuthority: (userId: string, isAuthority: boolean) => void;
  onRemove: (userId: string) => void;
  onReactivate: (userId: string) => void;
  onViewActivity: (member: Member) => void;
}) {
  return (
    <Section
      icon={<Shield className="w-4 h-4" />}
      title={`Members (${members.length})`}
      action={
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800/60 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      {members.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800/60">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/50 border-b border-slate-800/60">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 font-bold">Name</th>
                <th className="px-3 py-2 font-bold">Email</th>
                <th className="px-3 py-2 font-bold">Role</th>
                <th className="px-3 py-2 font-bold">Authority</th>
                <th className="px-3 py-2 font-bold">Last seen</th>
                {isAdmin && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.id === sessionUserId;
                const isDeactivated = m.status === 'deactivated';
                return (
                  <tr key={m.id} className={`border-t border-slate-800/40 ${isDeactivated ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 font-semibold text-white">
                      <span>{[m.first_name, m.last_name].filter(Boolean).join(' ') || <span className="text-slate-500 italic">Unnamed</span>}</span>
                      {isSelf && <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-400 font-bold">you</span>}
                      {!m.is_verified && <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400 font-bold">pending</span>}
                      {isDeactivated && <span className="ml-2 text-[10px] uppercase tracking-wider text-red-400 font-bold">deactivated</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-400 font-mono">{m.email}</td>
                    <td className="px-3 py-2">
                      {isAdmin ? (
                        <select
                          value={m.role}
                          onChange={(e) => onSetRole(m.id, e.target.value as Role)}
                          className="bg-slate-900/60 border border-slate-700/50 rounded-lg py-1 px-2 text-xs text-white focus:outline-none"
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-300">
                          {m.role === 'admin' && <Crown className="w-3 h-3 text-amber-400" />}
                          {m.role}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isAdmin ? (
                        <button
                          onClick={() => onSetAuthority(m.id, !m.is_permit_authority)}
                          title={m.is_permit_authority
                            ? 'Click to revoke permit authority status'
                            : 'Click to grant permit authority status'}
                          className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${m.is_permit_authority
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                            : 'bg-slate-800/60 text-slate-500 border-slate-700/40 hover:text-slate-300 hover:border-slate-600/60'}`}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          {m.is_permit_authority ? 'Authority' : 'Off'}
                        </button>
                      ) : (
                        m.is_permit_authority
                          ? <AuthorityBadge variant="compact" />
                          : <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {m.last_seen_at ? new Date(m.last_seen_at).toLocaleDateString() : '—'}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          {/* Per-member activity — every action by or
                              targeting this user. Available for self too
                              so admins can audit their own trail. */}
                          <button
                            onClick={() => onViewActivity(m)}
                            className="text-slate-500 hover:text-emerald-400 transition-colors p-1 rounded-lg hover:bg-emerald-500/10"
                            title="View activity log for this member"
                          >
                            <Activity className="w-4 h-4" />
                          </button>
                          {!isSelf && (
                            isDeactivated ? (
                              <button
                                onClick={() => onReactivate(m.id)}
                                className="text-slate-500 hover:text-emerald-400 transition-colors p-1 rounded-lg hover:bg-emerald-500/10"
                                title="Reactivate this member (restores access; data was never lost)"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => onRemove(m.id)}
                                className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10"
                                title="Deactivate (revokes access immediately; data preserved; reversible)"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
