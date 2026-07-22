import { Zap } from 'lucide-react';
import type { MasonPlacement } from '../stores/usePreferencesStore';

// ── Where does Mason ride along? ─────────────────────────────────────────────
// A spatial picker for Mason's dock corner: a miniature "screen" with a
// tappable target in each corner, the chosen one lit up with Mason's mark.
// Shared by first-run setup (OnboardingPage) and Settings so the control reads
// identically in both places. Purely presentational — the caller owns the
// preference write, so the same component drives onboarding and settings.

const CORNERS: { value: MasonPlacement; label: string; pos: string }[] = [
  { value: 'top-left', label: 'Top left', pos: 'top-2 left-2' },
  { value: 'top-right', label: 'Top right', pos: 'top-2 right-2' },
  { value: 'bottom-left', label: 'Bottom left', pos: 'bottom-2 left-2' },
  { value: 'bottom-right', label: 'Bottom right', pos: 'bottom-2 right-2' },
];

interface Props {
  value: MasonPlacement;
  onChange: (placement: MasonPlacement) => void;
  /** True when Mason has been dragged to a free position, so no corner is his
   *  current dock. Corners then read as "snap back to this corner". */
  floating?: boolean;
  className?: string;
}

export default function MasonPlacementPicker({ value, onChange, floating = false, className = '' }: Props) {
  return (
    <div
      className={`relative w-full aspect-[16/10] max-w-xs rounded-xl border border-slate-700/60 bg-slate-950/60 overflow-hidden ${className}`}
      role="group"
      aria-label="Mason screen position"
    >
      {/* Faux workspace chrome so the four targets read as screen corners. */}
      <div className="absolute inset-x-0 top-0 h-4 bg-slate-900/70 border-b border-slate-800/60" aria-hidden />
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <span className="text-[9px] uppercase tracking-[0.2em] text-slate-700 font-bold">
          {floating ? 'Placed freely' : 'Workspace'}
        </span>
      </div>
      {CORNERS.map((c) => {
        const active = !floating && value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            aria-pressed={active}
            aria-label={`Place Mason ${c.label.toLowerCase()}`}
            title={c.label}
            className={`absolute ${c.pos} w-11 h-11 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center transition-all ${
              active
                ? 'bg-amber-500/15 border border-amber-500/40 text-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.25)]'
                : 'bg-slate-800/40 border border-slate-700/50 text-slate-600 hover:text-amber-400/70 hover:border-amber-500/20'
            }`}
          >
            <Zap className="w-4 h-4" />
            {active && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full animate-pulse" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}
