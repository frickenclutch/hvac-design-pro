import { useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';

/**
 * Fixed top banner shown while an L0 admin is impersonating a tenant
 * (read-only 30-minute session). Mounted app-wide in AppLayout so the
 * admin can never forget whose workspace they're looking at.
 */
export default function ImpersonationBanner() {
  const impersonating = useAuthStore((s) => s.impersonating);
  const organisation = useAuthStore((s) => s.organisation);
  const exitImpersonation = useAuthStore((s) => s.exitImpersonation);
  const [exiting, setExiting] = useState(false);

  if (!impersonating) return null;

  const handleExit = async () => {
    setExiting(true);
    await exitImpersonation();
    // Hard navigation — every store re-initializes under the admin's own
    // org context instead of carrying tenant state across.
    window.location.assign('/admin');
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] mt-2 glass-panel rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2 flex items-center gap-3 shadow-lg shadow-amber-500/10 max-w-[calc(100vw-2rem)]"
    >
      <Eye className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <span className="text-xs font-semibold text-amber-200 truncate">
        Viewing <span className="text-white">{organisation?.name ?? 'tenant'}</span> as their admin — read-only
      </span>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="flex items-center gap-1.5 text-xs font-bold text-amber-300 hover:text-white bg-amber-500/20 hover:bg-amber-500/40 rounded-lg px-3 py-1.5 min-h-[32px] transition-colors disabled:opacity-50 flex-shrink-0"
      >
        <LogOut className="w-3.5 h-3.5" />
        {exiting ? 'Exiting…' : 'Exit'}
      </button>
    </div>
  );
}
