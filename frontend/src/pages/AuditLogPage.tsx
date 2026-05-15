/**
 * /audit-log — tenant-scope audit feed.
 *
 * Admins see everything that happened in their org (or to their org via
 * cross-tenant exceptions like Permits and Community). Non-admins see only
 * their own actions — the server enforces this in `routes/audit.ts`.
 *
 * L0 platform admins see the same tenant view here PLUS a toggle to switch
 * to the cross-tenant view, which is also embedded into /admin so they can
 * jump in directly without leaving their dashboard.
 */

import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Activity, ShieldCheck, Building2, ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { useAccessPolicyStore } from '../stores/useAccessPolicyStore';
import AuditLogView from '../components/AuditLogView';

export default function AuditLogPage() {
  const user = useAuthStore((s) => s.user);
  const organisation = useAuthStore((s) => s.organisation);
  const canViewAudit = useAccessPolicyStore((s) => s.capabilities.canViewAudit);
  const policyLoaded = useAccessPolicyStore((s) => s.loaded);
  const [scope, setScope] = useState<'tenant' | 'platform'>('tenant');

  if (!user) return <Navigate to="/" replace />;

  // Defense-in-depth: the server 403s every audit endpoint below the
  // auditView threshold, but we also block the route so a direct URL
  // visit doesn't render an empty shell that fires doomed requests.
  // Wait for the policy to load before deciding (avoids a flash-redirect
  // for admins on a cold load).
  if (policyLoaded && !canViewAudit) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="px-4 py-6 md:p-8 md:pt-12 h-full flex flex-col overflow-y-auto">
      <header className="mb-6">
        <Link
          to="/team"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 mb-3"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back to Team
        </Link>
        <div className="flex items-start md:items-center justify-between gap-3 flex-col md:flex-row">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
              scope === 'platform'
                ? 'bg-amber-500/10 border border-amber-500/30'
                : 'bg-emerald-500/10 border border-emerald-500/30'
            }`}>
              {scope === 'platform'
                ? <ShieldCheck className="w-5 h-5 text-amber-400" />
                : <Activity className="w-5 h-5 text-emerald-400" />}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">
                {scope === 'platform' ? 'Platform audit log' : 'Audit log'}
              </h1>
              <p className="text-slate-400 text-sm flex items-center gap-1.5">
                {scope === 'platform'
                  ? 'Every action across every tenant.'
                  : <>
                    <Building2 className="w-3.5 h-3.5" />
                    {organisation?.name ?? 'Your organisation'}
                    {user.role !== 'admin' && (
                      <span className="text-xs text-slate-600 ml-1">— your actions only</span>
                    )}
                  </>}
              </p>
            </div>
          </div>

          {user.isPlatformAdmin && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900/60 border border-slate-700">
              <button
                onClick={() => setScope('tenant')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  scope === 'tenant'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                My org
              </button>
              <button
                onClick={() => setScope('platform')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  scope === 'platform'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Platform-wide
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="pb-20">
        <AuditLogView
          scope={scope}
          showOrgFilter={scope === 'platform'}
          // Re-mount the view when scope flips so internal state resets.
          key={scope}
        />
      </div>
    </div>
  );
}
