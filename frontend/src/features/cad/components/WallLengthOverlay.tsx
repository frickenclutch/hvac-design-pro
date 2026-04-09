import { useCadStore } from '../store/useCadStore';
import { fmtLength, fmtSmallLength } from '../../../utils/units';

/**
 * WallLengthOverlay
 *
 * A translucent floating HUD that shows:
 *  – While drawing: live length of the in-progress wall (positioned near the cursor)
 *  – When a wall is selected: its key stats at the bottom-center of the viewport
 *  – Otherwise: nothing
 *
 * This component reads only from Zustand — no props, no canvas refs needed.
 */
export default function WallLengthOverlay() {
  const { drawingInfo, selectedWallId, walls, projectScale } = useCadStore();

  // ── Active drawing: cursor-following badge ─────────────────────────────
  if (drawingInfo?.isDrawing) {
    const { lengthFt, screenX, screenY } = drawingInfo;
    return (
      <div
        className="fixed z-50 pointer-events-none"
        style={{
          left: screenX + 18,
          top: screenY - 38,
          transform: 'translateZ(0)',
        }}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-sky-500/40 shadow-[0_0_20px_rgba(56,189,248,0.25)] backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <span className="text-sky-300 text-xs font-bold font-mono tracking-wide">
            {fmtLength(lengthFt)}
          </span>
        </div>
      </div>
    );
  }

  // ── Wall selected: bottom-center status pill ───────────────────────────
  if (selectedWallId) {
    const wall = walls.find((w) => w.id === selectedWallId);
    if (wall) {
      const dx = wall.x2 - wall.x1;
      const dy = wall.y2 - wall.y1;
      const lengthFt = Math.sqrt(dx * dx + dy * dy) / projectScale.pxPerFt;

      return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-slate-900/90 border border-emerald-500/30 shadow-[0_0_30px_rgba(52,211,153,0.15)] backdrop-blur-xl">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-slate-300 text-xs font-mono tracking-wide">
              Wall
            </span>
            <Divider />
            <span className="text-emerald-300 text-xs font-bold font-mono">
              {fmtLength(lengthFt)}
            </span>
            <Divider />
            <span className="text-slate-400 text-xs font-mono">
              R-{wall.rValue}
            </span>
            <Divider />
            <span className="text-slate-400 text-xs font-mono">
              {fmtSmallLength(wall.thicknessIn, 0)}
            </span>
          </div>
        </div>
      );
    }
  }

  return null;
}

function Divider() {
  return <span className="w-px h-3 bg-slate-700 rounded-full" />;
}
