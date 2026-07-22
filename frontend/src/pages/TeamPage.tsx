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

import { useEffect, useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Users, UserPlus, Globe, Mail, Trash2, Shield, RefreshCw,
  AlertTriangle, CheckCircle2, Copy, Crown, ShieldCheck, Activity, RotateCcw,
  Building2, ArrowRightLeft, Search, X, ArrowUpDown, Check, GripVertical, Minus, Plus,
} from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { usePreferencesStore, type UserPreferences } from '../stores/usePreferencesStore';
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

// A left-rail category — one card group per row. Mirrors the Settings
// registry (SettingsCategoryEntry): `visible` gates by viewer, `keywords`
// feed the rail search, `node` is the card(s) rendered in the detail pane.
interface TeamCategoryEntry {
  id: string;
  title: string;
  icon: React.ReactNode;
  keywords: string[];
  visible: boolean;
  node: React.ReactNode;
}

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

  // ── Rail state (mirrors the Settings/Admin master-detail contract) ─────────
  const teamNavOrder = usePreferencesStore((s) => s.teamNavOrder);
  const teamNavHidden = usePreferencesStore((s) => s.teamNavHidden);
  const teamLastCategory = usePreferencesStore((s) => s.teamLastCategory);
  const updatePrefs = usePreferencesStore((s) => s.update);

  // Registry → the DEFAULT (registry) order of categories visible to this
  // viewer. Every card keeps its exact handlers; this only reframes WHERE they
  // render. Visibility preserves today's behavior precisely: Transfers is
  // admin-only, Subdivisions hides for orgs that are themselves a subdivision,
  // and the pending-invite list + read-only subdivision view stay visible to
  // non-admins (the invite/create forms inside gate on isAdmin as before).
  const baseCategories: TeamCategoryEntry[] = [
    {
      id: 'members',
      title: 'Members',
      icon: <Users className="w-4 h-4" />,
      keywords: ['members', 'roster', 'people', 'users', 'role', 'roles', 'deactivate', 'reactivate', 'authority', 'activity', 'seats'],
      visible: true,
      node: (
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
      ),
    },
    {
      id: 'invitations',
      title: 'Invitations',
      icon: <Mail className="w-4 h-4" />,
      keywords: ['invite', 'invitation', 'invitations', 'pending', 'email', 'redeem', 'link', 'onboard', 'send invite'],
      visible: true,
      node: (
        <div className="space-y-6">
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
        </div>
      ),
    },
    {
      id: 'transfers',
      title: 'Transfers',
      icon: <ArrowRightLeft className="w-4 h-4" />,
      keywords: ['transfer', 'transfers', 'reparent', 'move account', 'account', 'ownership', 'bring in'],
      visible: isAdmin,
      node: (
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
      ),
    },
    {
      id: 'subdivisions',
      title: 'Subdivisions',
      icon: <Building2 className="w-4 h-4" />,
      keywords: ['subdivision', 'subdivisions', 'division', 'branch', 'subsidiary', 'dba', 'child org', 'department', 'sub-org'],
      // Hidden for orgs that are themselves a subdivision (single-level tree).
      visible: !parentOrg,
      node: (
        <SubdivisionsCard
          subdivisions={subdivisions}
          isAdmin={isAdmin}
          onCreate={async (name) => {
            try {
              await api.teamCreateSubdivision(name);
              setInfo(`Subdivision "${name}" created. Invite its first admin from the Invitations tab.`);
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
      ),
    },
    {
      id: 'domain',
      title: 'Domain',
      icon: <Globe className="w-4 h-4" />,
      keywords: ['domain', 'email domain', 'claimed domain', 'dns', 'verify', 'tenant', 'signup'],
      visible: true,
      node: (
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
      ),
    },
  ].filter((c) => c.visible);

  // Apply the user's custom order (arrange mode); anything shipped since they
  // last arranged appends in registry order — same rule as Settings / CAD toolbox.
  const orderedCategories = (() => {
    if (!teamNavOrder) return baseCategories;
    const byId = new Map(baseCategories.map((c) => [c.id, c]));
    const known = teamNavOrder.map((id) => byId.get(id)).filter((c): c is TeamCategoryEntry => !!c);
    const missing = baseCategories.filter((c) => !teamNavOrder.includes(c.id));
    return [...known, ...missing];
  })();
  // Rail = ordered minus hidden; search + deep-links still reach hidden ones.
  const railCategories = orderedCategories.filter((c) => !teamNavHidden.includes(c.id));

  // Active category: URL hash → last-open pref → first visible.
  const [active, setActive] = useState<string>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return hash || teamLastCategory || '';
  });
  const [query, setQuery] = useState('');
  const [arrangeMode, setArrangeMode] = useState(false);

  // Resolves against the full ordered set (so a deep-linked / last-open hidden
  // category still renders), else falls back to the first visible category.
  const activeCat = orderedCategories.find((c) => c.id === active) ?? railCategories[0] ?? orderedCategories[0];
  useEffect(() => {
    if (activeCat && activeCat.id !== active) setActive(activeCat.id);
  }, [activeCat, active]);

  // Follow deep-links (Cmd+K jumps, back/forward navigations).
  const location = useLocation();
  useEffect(() => {
    const h = location.hash.replace('#', '');
    if (h) { setActive(h); setQuery(''); }
  }, [location.hash]);

  const selectCategory = (id: string) => {
    setActive(id);
    updatePrefs({ teamLastCategory: id });
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${id}`);
  };
  const pickCategory = (id: string) => { setQuery(''); selectCategory(id); };
  const enterArrange = () => { setArrangeMode(true); setQuery(''); };

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const filteredList = searching
    ? orderedCategories.filter((c) => `${c.title} ${c.keywords.join(' ')}`.toLowerCase().includes(q))
    : [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        {/* Metallic portal-plate hero — the same brushed-steel plate, sheen and
            engraved metal-ink as the Settings hero, carrying Team's own mark. */}
        <header className="mb-8">
          <div className="portal-plate portal-menu-emerge relative overflow-hidden rounded-2xl border border-slate-700/70 p-5 sm:p-6 flex items-center gap-4 sm:gap-5 shadow-[0_16px_50px_rgba(0,0,0,0.6)]">
            <span aria-hidden className="portal-menu-sheen absolute inset-0 pointer-events-none" />
            {/* Team's identity in the metallic ring frame (not the portal's
                black-hole — this is Team, not the Creation Portal). */}
            <div className="portal-button-metallic relative w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center shrink-0">
              <span aria-hidden className="portal-ring-metallic absolute inset-[-50%]" />
              <span aria-hidden className="absolute inset-[2px] rounded-[14px] bg-slate-950/95" />
              <Users className="relative z-10 w-7 h-7 text-emerald-300" />
            </div>
            <div className="relative z-10 min-w-0 flex-1">
              <p className="metal-ink-soft text-[10px] font-mono font-bold uppercase tracking-[0.25em]">Organisation</p>
              <h2 className="metal-ink text-2xl sm:text-3xl font-extrabold leading-tight">Team</h2>
              <p className="metal-ink-soft text-xs sm:text-sm font-semibold truncate">
                {orgName ? `${orgName} · ` : ''}members of your organisation
                {parentOrg && <span> · subdivision of {parentOrg.name}</span>}
              </p>
            </div>
            <Link
              to="/audit-log"
              className="relative z-10 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/90 hover:bg-slate-900/90 border border-white/10 text-sm text-slate-200 hover:text-emerald-300 transition-colors min-h-[44px] shrink-0"
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

        <div className="flex flex-col md:flex-row gap-6">
          {/* Left rail — mirrors Settings: search + arrange/hide over a
              registry-driven category list. Horizontal-scroll on mobile,
              sticky vertical list on desktop. */}
          <nav className="md:w-56 md:shrink-0 md:sticky md:top-4 self-start w-full" aria-label="Team categories">
            {!arrangeMode && (
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search team…"
                  aria-label="Search team"
                  className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl pl-9 pr-8 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 min-h-[44px]"
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {/* Rail toolbar — Arrange (reorder / hide). Compact + muted so it
                stays out of the way of everyday use. */}
            <div className="flex items-center gap-1.5 mb-3">
              <button
                onClick={() => (arrangeMode ? setArrangeMode(false) : enterArrange())}
                aria-pressed={arrangeMode}
                title={arrangeMode ? 'Done arranging' : 'Arrange categories — drag to reorder, hide what you don’t use'}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors min-h-[36px] ${arrangeMode ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'}`}
              >
                {arrangeMode ? <Check className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3.5 h-3.5" />}
                {arrangeMode ? 'Done' : 'Arrange'}
              </button>
            </div>

            {arrangeMode ? (
              <TeamArrangeRail
                categories={orderedCategories}
                hidden={teamNavHidden}
                defaultOrder={baseCategories.map((c) => c.id)}
                onChange={updatePrefs}
              />
            ) : (
              <TeamRail categories={railCategories} active={searching ? '' : (activeCat?.id ?? '')} onSelect={pickCategory} />
            )}
          </nav>

          {/* Detail pane — the arrange hint, the search results, or the active
              category's card(s). #id anchors keep categories deep-linkable. */}
          <div className="flex-1 min-w-0 space-y-6">
            {arrangeMode ? (
              <TeamArrangeHint />
            ) : searching ? (
              filteredList.length === 0 ? (
                <p className="text-sm text-slate-500 py-10 text-center">No team categories match “{query}”.</p>
              ) : (
                filteredList.map((c) => (
                  <div key={c.id} id={c.id} className="scroll-mt-24">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 ml-1">{c.title}</p>
                    {c.node}
                  </div>
                ))
              )
            ) : (
              activeCat && <div key={activeCat.id} id={activeCat.id} className="scroll-mt-24">{activeCat.node}</div>
            )}
          </div>
        </div>

        {/* Overlays — unchanged behavior, lifted out of the flow so they render
            above whichever category is open. */}
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
  );
}

// ── Left rail (mirrors SettingsRail / SettingsArrangeRail) ──────────────────
// Duplicated per-page, exactly as the Admin panel duplicated it — extracting a
// shared rail would mean refactoring two working, shipped pages, a riskier
// separate unit. See the DRY-cleanup follow-up.
function TeamRail({ categories, active, onSelect }: { categories: TeamCategoryEntry[]; active: string; onSelect: (id: string) => void }) {
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
            <span className={isActive ? 'text-emerald-400' : 'text-slate-500'}>{c.icon}</span>
            {c.title}
          </button>
        );
      })}
    </div>
  );
}

// Arrange mode — reorder + hide categories, mirroring SettingsArrangeRail
// (prefs.teamNavOrder / teamNavHidden). Rows become draggable; the − button
// sends a category to the hidden tray; hidden categories stay reachable from
// search. Reset restores the registry's default order and the full set.
function TeamArrangeRail({ categories, hidden, defaultOrder, onChange }: {
  categories: TeamCategoryEntry[];   // full viewer-visible set, current order
  hidden: string[];
  defaultOrder: string[];            // registry order of viewer-visible ids
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
    // Persist the reordered VISIBLE ids, keeping hidden ids after them so an
    // unhide later drops the category back at a sensible spot. Matching the
    // registry order exactly reverts to null (default order, no divergence).
    const full = [...finalVisible, ...hiddenIds];
    const isDefault = full.length === defaultOrder.length && full.every((x, i) => x === defaultOrder[i]);
    onChange({ teamNavOrder: isDefault ? null : full });
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

  const hideCat = (id: string) => onChange({ teamNavHidden: [...hidden.filter((h) => h !== id), id] });
  const restoreCat = (id: string) => onChange({ teamNavHidden: hidden.filter((h) => h !== id) });
  const reset = () => onChange({ teamNavOrder: null, teamNavHidden: [] });

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
            className={`relative flex items-center gap-2 px-2.5 py-2.5 rounded-xl text-sm font-semibold cursor-grab active:cursor-grabbing transition-shadow min-h-[44px] ${dragId === id ? 'ring-2 ring-emerald-400/70 bg-slate-800/80 z-10' : 'ring-1 ring-slate-700/60 hover:ring-slate-500/70 bg-slate-900/40'}`}
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
        title="Reset to the default order with every category shown"
        className="mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-amber-300 hover:bg-slate-800/60 transition-colors min-h-[36px]"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Reset order
      </button>
    </div>
  );
}

function TeamArrangeHint() {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6 text-sm text-slate-400 leading-relaxed">
      <div className="flex items-center gap-2 mb-2 text-slate-200 font-semibold">
        <ArrowUpDown className="w-4 h-4 text-emerald-400" /> Arranging categories
      </div>
      <p>
        Drag the rows on the left to reorder your Team categories. Use the
        <span className="inline-flex items-center justify-center align-middle mx-1 w-4 h-4 rounded-full bg-slate-800 border border-slate-600"><Minus className="w-2.5 h-2.5" /></span>
        on a row to hide a category from the rail — it stays reachable from search.
        Click <span className="text-emerald-300 font-semibold">Done</span> when you're finished; your layout saves automatically to this workbench.
      </p>
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
    <section className="rounded-2xl border border-slate-700/60 overflow-hidden shadow-[0_10px_36px_rgba(0,0,0,0.45)]">
      {/* Machined header strip — the brushed-steel plate, sheen, enamel icon
          chip, and engraved metal-ink of the Creation Portal / Settings
          surfaces. Not a collapse toggle (cards carry an optional `action`
          button, e.g. Members' refresh, so the header stays inert). */}
      <header className="portal-plate relative px-5 py-3.5 flex items-center gap-3">
        <span aria-hidden className="portal-menu-sheen absolute inset-0 pointer-events-none" />
        <span className="relative z-10 w-9 h-9 rounded-xl bg-slate-900 border-2 border-slate-950/60 flex items-center justify-center shrink-0 text-emerald-400 shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),0_2px_5px_rgba(0,0,0,0.5)]">
          {icon}
        </span>
        <div className="relative z-10 min-w-0">
          <h3 className="metal-ink text-sm font-bold uppercase tracking-widest truncate">{title}</h3>
          {subtitle && <p className="metal-ink-soft text-[11px] font-semibold">{subtitle}</p>}
        </div>
        {action && <div className="relative z-10 ml-auto shrink-0">{action}</div>}
      </header>
      {/* Dark body keeps the form controls legible below the metal header. */}
      <div className="bg-slate-900/60 backdrop-blur-xl p-5 border-t border-slate-950/50">{children}</div>
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
        Each subdivision is a full workspace with its own members and projects. Staff it from the Invitations tab (choose the subdivision as the destination); its first member must be an admin. Only empty subdivisions can be removed.
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
