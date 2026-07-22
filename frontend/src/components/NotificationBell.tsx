import { useId } from 'react';

interface NotificationBellProps {
  /** Something is pending — render the alert state (energy swirls + glow). */
  pending?: boolean;
  /** Alerts are muted (DND) — dim the bell and show the "off" slash; suppresses
   *  the pending swirls even when `pending` is true. */
  muted?: boolean;
  /** px size of the square icon. */
  size?: number;
  className?: string;
}

/**
 * ── The Elemental Notification Bell ───────────────────────────────────────────
 *
 * A hand-drawn tri-metal bell distilled from Nathan's render: a copper dome, a
 * brass mid-band, a silver flared + engraved skirt, a classical silver yoke, and
 * a dark iron clapper. Two states drive it — idle ("nothing pending") and pending
 * ("alert"), the latter wreathed in the ethereal energy swirls from the alert
 * render. A third, muted, dims it and strikes it through when alerts are off.
 *
 * Pure visual, no store coupling — the count badge is overlaid by the parent.
 * Gradient ids are instance-scoped via useId() so multiple bells (sidebar +
 * mobile) never collide. Motion lives in index.css and is frozen under
 * reduced-motion; the swirls stay drawn so "pending" still reads without motion.
 */
export default function NotificationBell({
  pending = false,
  muted = false,
  size = 26,
  className = '',
}: NotificationBellProps) {
  const uid = useId().replace(/:/g, '');
  const copper = `copper-${uid}`;
  const copperSpec = `copperspec-${uid}`;
  const brass = `brass-${uid}`;
  const silver = `silver-${uid}`;
  const yoke = `yoke-${uid}`;
  const clapper = `clapper-${uid}`;
  const energy = `energy-${uid}`;
  const glow = `glow-${uid}`;
  const clip = `bellclip-${uid}`;

  // Full bell outline — symmetric about x=24. Flares out at the lip, tucks to a
  // waist, bulges through the copper dome, tapers to the crown.
  const bellPath =
    'M 10 38.6 ' +
    'C 10 36, 11 35, 12 33.8 ' +
    'C 14 30.2, 15.2 30, 15 27.4 ' +
    'C 14.8 23, 13.6 22, 14 19 ' +
    'C 14.5 15, 18 12.6, 21.6 11.9 ' +
    'C 22.4 11.7, 23.2 11.6, 24 11.6 ' +
    'C 24.8 11.6, 25.6 11.7, 26.4 11.9 ' +
    'C 30 12.6, 33.5 15, 34 19 ' +
    'C 34.4 22, 33.2 23, 33 27.4 ' +
    'C 32.8 30, 34 30.2, 36 33.8 ' +
    'C 37 35, 38 36, 38 38.6 ' +
    'Z';

  const pendingActive = pending && !muted;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={`bell-icon ${pendingActive ? 'is-pending' : ''} ${muted ? 'is-muted' : ''} ${className}`}
      style={{ display: 'block' }}
    >
      <defs>
        {/* Copper dome */}
        <linearGradient id={copper} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eaa878" />
          <stop offset="0.45" stopColor="#c47a4e" />
          <stop offset="1" stopColor="#8a4a2c" />
        </linearGradient>
        {/* Specular streak on the copper */}
        <radialGradient id={copperSpec} cx="0.34" cy="0.3" r="0.5">
          <stop offset="0" stopColor="#fff3e8" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff3e8" stopOpacity="0" />
        </radialGradient>
        {/* Brass band */}
        <linearGradient id={brass} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#f2d68c" />
          <stop offset="0.5" stopColor="#cda43f" />
          <stop offset="1" stopColor="#916d20" />
        </linearGradient>
        {/* Silver skirt / yoke */}
        <linearGradient id={silver} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#f7f9fc" />
          <stop offset="0.5" stopColor="#cfd8e3" />
          <stop offset="1" stopColor="#8794a6" />
        </linearGradient>
        <linearGradient id={yoke} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7f9fc" />
          <stop offset="0.55" stopColor="#c3cede" />
          <stop offset="1" stopColor="#7c8798" />
        </linearGradient>
        {/* Dark iron clapper */}
        <linearGradient id={clapper} x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#5a5148" />
          <stop offset="1" stopColor="#211d18" />
        </linearGradient>
        {/* Energy ribbon — transparent → cyan → white → cyan → transparent */}
        <linearGradient id={energy} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#67e8f9" stopOpacity="0" />
          <stop offset="0.3" stopColor="#67e8f9" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#f0fbff" stopOpacity="1" />
          <stop offset="0.7" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#38bdf8" stopOpacity="0.12" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clip}>
          <path d={bellPath} />
        </clipPath>
      </defs>

      {/* Pending aura — soft cyan bloom behind the bell */}
      {pendingActive && (
        <circle className="bell-glow" cx="24" cy="24" r="20" fill={`url(#${glow})`} />
      )}

      {/* Energy swirls — only in the pending state. Two counter-tilted ribbons
          orbiting the bell, echoing the alert render's vortex. */}
      {pendingActive && (
        <g className="bell-swirls" stroke={`url(#${energy})`} strokeWidth="1.7" strokeLinecap="round" fill="none">
          <ellipse className="bell-swirl bell-swirl-a" cx="24" cy="22" rx="18" ry="8" transform="rotate(-18 24 22)" />
          <ellipse className="bell-swirl bell-swirl-b" cx="24" cy="24" rx="15.5" ry="10.5" transform="rotate(24 24 24)" />
        </g>
      )}

      {/* The bell itself — swaying gently while pending */}
      <g className="bell-body">
        {/* Yoke — suspension ring + crown mount (silver) */}
        <circle cx="24" cy="6.1" r="2.5" stroke={`url(#${yoke})`} strokeWidth="1.5" fill="none" />
        <path
          d="M 21.6 11.9 C 21.4 10, 21.8 9, 22.4 8.4 L 25.6 8.4 C 26.2 9, 26.6 10, 26.4 11.9 Z"
          fill={`url(#${yoke})`}
        />

        {/* Tri-metal body, banded within the bell clip */}
        <g clipPath={`url(#${clip})`}>
          {/* Silver skirt fills the whole body as the base layer */}
          <rect x="8" y="11" width="32" height="29" fill={`url(#${silver})`} />
          {/* Copper dome */}
          <rect x="8" y="11" width="32" height="11.5" fill={`url(#${copper})`} />
          <rect x="8" y="11" width="32" height="11.5" fill={`url(#${copperSpec})`} />
          {/* Brass band */}
          <rect x="8" y="21.6" width="32" height="4.8" fill={`url(#${brass})`} />
          {/* Band separators */}
          <line x1="8" y1="21.7" x2="40" y2="21.7" stroke="#5c3c1e" strokeOpacity="0.5" strokeWidth="0.6" />
          <line x1="8" y1="26.3" x2="40" y2="26.3" stroke="#6b5417" strokeOpacity="0.5" strokeWidth="0.6" />
          {/* Engraved filigree lines near the lip */}
          <line x1="8" y1="33.4" x2="40" y2="33.4" stroke="#64748b" strokeOpacity="0.7" strokeWidth="0.7" />
          <line x1="8" y1="35.4" x2="40" y2="35.4" stroke="#94a3b8" strokeOpacity="0.6" strokeWidth="0.5" />
        </g>

        {/* Machined outline for crisp definition on the dark chrome */}
        <path d={bellPath} stroke="#e8eef5" strokeOpacity="0.55" strokeWidth="0.8" fill="none" />

        {/* Open-rim shadow at the lip + clapper */}
        <ellipse cx="24" cy="38.4" rx="14" ry="1.7" fill="#1b120b" fillOpacity="0.35" />
        <path d="M 24 33 L 24 38.5" stroke={`url(#${clapper})`} strokeWidth="1.3" />
        <circle cx="24" cy="40.4" r="2.4" fill={`url(#${clapper})`} stroke="#0f0c09" strokeOpacity="0.5" strokeWidth="0.5" />
      </g>

      {/* Muted strike-through */}
      {muted && (
        <line
          x1="9" y1="10" x2="39" y2="42"
          stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round"
          className="bell-mute-slash"
        />
      )}
    </svg>
  );
}
