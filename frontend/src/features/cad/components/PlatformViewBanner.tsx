import { ShieldCheck, LogOut } from 'lucide-react';

/**
 * Fixed top banner shown while an L0 platform admin is viewing another
 * tenant's project in the read-only cross-tenant CAD viewer
 * (/platform/project/:id/cad). Unlike ImpersonationBanner this involves NO
 * session swap — the admin stays in their own org; the drawing was fetched
 * through the audited platform read endpoints. The banner is the single
 * visible cue that this canvas belongs to another tenant and cannot be edited.
 */
export default function PlatformViewBanner({
  orgName,
  projectName,
}: {
  orgName: string | null;
  projectName: string | null;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] mt-2 glass-panel rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2 flex items-center gap-3 shadow-lg shadow-amber-500/10 max-w-[calc(100vw-2rem)]"
    >
      <ShieldCheck className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <span className="text-xs font-semibold text-amber-200 truncate">
        Read-only platform view
        {projectName ? <> — <span className="text-white">{projectName}</span></> : null}
        {orgName ? <span className="text-amber-300/80"> · {orgName}</span> : null}
      </span>
      <a
        href="/admin"
        className="flex items-center gap-1.5 text-xs font-bold text-amber-300 hover:text-white bg-amber-500/20 hover:bg-amber-500/40 rounded-lg px-3 py-1.5 min-h-[32px] transition-colors flex-shrink-0"
      >
        <LogOut className="w-3.5 h-3.5" />
        Exit
      </a>
    </div>
  );
}
