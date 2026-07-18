/** Vortex glyph for creation-portal triggers — concentric swirl arcs around
 *  a core, drawn in currentColor so each button's color states and glow apply
 *  unchanged. Shared by the CAD top bar and the Dashboard New Project button. */
export default function PortalVortexIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="2.3" fill="currentColor" />
      <path d="M12 6.5 A5.5 5.5 0 0 1 14.75 16.76" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 17.5 A5.5 5.5 0 0 1 9.25 7.24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18.36 5.64 A9 9 0 0 1 9.67 20.69" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.64 18.36 A9 9 0 0 1 14.33 3.31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
