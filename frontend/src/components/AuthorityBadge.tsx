/**
 * AuthorityBadge — visual marker for permit-authority users.
 *
 * Surfaces wherever an authority user identifies themselves to others
 * (avatar menu, comment threads, project tiles, submission queue). The
 * gold-amber palette is deliberately distinct from the platform-admin
 * amber so the two creator-layer badges don't get confused at a glance.
 *
 * Variants:
 *   compact  — tight chip (use in dense lists like comment headers)
 *   inline   — text + icon, no border (use next to a username)
 *   pill     — full chip with title (use in headers and detail panels)
 */

import { ShieldCheck } from 'lucide-react';

type Variant = 'compact' | 'inline' | 'pill';

interface AuthorityBadgeProps {
  /** Display title — e.g. "Code Enforcement Officer", "Plan Reviewer". */
  title?: string | null;
  /** Optional org name for context — "City of Syracuse — Building Dept". */
  orgName?: string | null;
  variant?: Variant;
  className?: string;
}

export default function AuthorityBadge({
  title, orgName, variant = 'pill', className = '',
}: AuthorityBadgeProps) {
  const label = title || 'Permit Authority';

  if (variant === 'compact') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 ${className}`}
        title={orgName ? `${label} — ${orgName}` : label}
      >
        <ShieldCheck className="w-3 h-3" />
        <span className="hidden sm:inline">Authority</span>
      </span>
    );
  }

  if (variant === 'inline') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-amber-300 ${className}`}
        title={orgName ? `${label} — ${orgName}` : label}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        <span className="text-xs font-semibold">{label}</span>
      </span>
    );
  }

  // pill (default)
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 ${className}`}
      title={orgName ?? undefined}
    >
      <ShieldCheck className="w-3 h-3" />
      {label}
    </span>
  );
}
