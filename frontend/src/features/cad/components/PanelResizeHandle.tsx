import { useCallback, useRef } from 'react';

interface PanelResizeHandleProps {
  /** Which edge the handle sits on ('left' = drag left edge to resize, 'right' = drag right edge) */
  edge: 'left' | 'right';
  /** Current panel width in px */
  currentWidth: number;
  /** Called continuously during drag with the new width */
  onResize: (newWidth: number) => void;
  /** Min width clamp (default 200) */
  minWidth?: number;
  /** Max width clamp (default 600) */
  maxWidth?: number;
}

/**
 * A thin drag-handle that sits on the inner edge of a panel.
 * Drag horizontally to resize the parent panel.
 */
export default function PanelResizeHandle({
  edge,
  currentWidth,
  onResize,
  minWidth = 200,
  maxWidth = 600,
}: PanelResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(currentWidth);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = currentWidth;

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const onMove = (me: PointerEvent) => {
        if (!dragging.current) return;
        const delta = me.clientX - startX.current;
        // Left edge: dragging left => wider, dragging right => narrower
        // Right edge: dragging right => wider, dragging left => narrower
        const multiplier = edge === 'left' ? -1 : 1;
        const newWidth = Math.round(
          Math.min(maxWidth, Math.max(minWidth, startW.current + delta * multiplier)),
        );
        onResize(newWidth);
      };

      const onUp = () => {
        dragging.current = false;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [currentWidth, edge, minWidth, maxWidth, onResize],
  );

  const positionClass = edge === 'left' ? 'left-0 top-0 bottom-0' : 'right-0 top-0 bottom-0';

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`absolute ${positionClass} w-1.5 cursor-col-resize z-20 group`}
      title="Drag to resize"
    >
      {/* Visible grip indicator on hover */}
      <div className="absolute inset-y-0 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-emerald-500/30 rounded-full" />
      {/* Center dots */}
      <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-60 transition-opacity">
        <div className="w-1 h-1 rounded-full bg-emerald-400" />
        <div className="w-1 h-1 rounded-full bg-emerald-400" />
        <div className="w-1 h-1 rounded-full bg-emerald-400" />
      </div>
    </div>
  );
}
