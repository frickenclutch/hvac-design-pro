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
}

const ROLES: Role[] = ['admin', 'engineer', 'tech', 'viewer'];

export default function TeamPage() {
  const sessionUser = useAuthStore((s) => s.user);
  const orgName = useAuthStore((s) => s.organisation?.name);

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [domain, setDomain] = useState<{ claimed: string | null; verifiedAt: string | null }>({ claimed: null, verifiedAt: null });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Per-member activity modal — set to the member object you want to audit,
  // null when closed. Admin-only; non-admins see their own history via
  // the global /audit-log page instead.
  const [auditTarget, setAuditTarget] = useState<Member | null>(null);

  const isAdmin = sessionUser?.role === 'admin';

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.teamList();
      setMembers(data.members);
      setInvites(data.invites);
      setDomain(data.domain);
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
              onInvite={async (email, role) => {
                try {
                  const r = await api.teamInvite(email, role);
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
            onSetRole={async (userId, role) => {
              try {
                await api.teamSetRole(userId, role);
                setInfo('Role updated.');
                refresh();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
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
            onRemove={async (userId) => {
              if (!confirm('Deactivate this member? They lose access immediately and their live sessions are revoked. Their projects, calcs and history are preserved, and you can reactivate them later.')) return;
              try {
                await api.teamRemoveMember(userId);
                setInfo('Member deactivated. Access revoked; data preserved.');
                refresh();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
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
        </div>
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

function InviteCard({ defaultDomain, onInvite }: { defaultDomain: string | null; onInvite: (email: string, role: Role) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('tech');

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
        <button
          onClick={() => {
            if (!email.trim()) return;
            onInvite(email.trim(), role);
            setEmail('');
          }}
          className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all flex items-center gap-1.5"
        >
          <Mail className="w-3.5 h-3.5" /> Send invite
        </button>
      </div>
      <p className="text-[11px] text-slate-500 mt-3">
        The invited address gets an email with a one-click acceptance link. If delivery fails (corporate filter, typo'd domain) use the copy button in the pending list to share the link manually.
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
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold px-2 py-0.5 rounded bg-slate-800/60">{inv.invited_role}</span>
              <span className="text-[10px] text-slate-600 font-mono">expires {new Date(inv.expires_at).toLocaleDateString()}</span>
              {isAdmin && (
                <>
                  <button
                    onClick={() => onCopy((inv as Invite & { token?: string }).token ?? inv.id)}
                    className="text-slate-400 hover:text-emerald-400 text-xs font-bold flex items-center gap-1"
                    title="Copy redemption link"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
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
