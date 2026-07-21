import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
import type { ToolboxPosition } from '../../../stores/usePreferencesStore';

/** Minimum px from any viewport edge when a floating panel is dragged. */
const EDGE_MARGIN = 8;

/** panelSizes fields that hold a nullable free-float position. */
type PosKey = 'propertiesPos' | 'layersPos';

/**
 * Turns a docked CAD panel (Properties, Layers) into a movable island —
 * mirroring the Toolbox/FloorSelector drag pattern. `null` position keeps the
 * panel in its default rail dock; the first drag pops it off, and the position
 * persists per-user in `panelSizes[key]`. `dock()` snaps it back to the rail.
 *
 * Drag lives on a header handle: pointerdown that lands on an interactive child
 * (button/input/select/a/textarea) is ignored so the panel's own controls keep
 * working. The final position is persisted on pointerup as a plain store call —
 * never inside a setState updater (React forbids cross-store writes mid-render),
 * the same discipline the Toolbox uses.
 */
export function useDraggablePanel(
  key: PosKey,
  panelRef: React.RefObject<HTMLDivElement | null>,
) {
  const saved = usePreferencesStore((s) => s.panelSizes[key]);
  const updatePrefs = usePreferencesStore((s) => s.update);

  const [pos, setPos] = useState<ToolboxPosition | null>(saved ?? null);
  const posRef = useRef<ToolboxPosition | null>(pos);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });

  const persist = useCallback(
    (p: ToolboxPosition | null) => {
      const ps = usePreferencesStore.getState().panelSizes;
      updatePrefs({ panelSizes: { ...ps, [key]: p } });
    },
    [key, updatePrefs],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Never start a drag from an interactive control inside the handle.
      if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return;
      e.preventDefault();
      e.stopPropagation();

      const el = panelRef.current;
      const rect = el?.getBoundingClientRect();

      // First drag off the dock: seed the float position from where the panel
      // currently sits so it doesn't jump before following the cursor.
      let origin = posRef.current;
      if (!origin && rect) {
        origin = { x: Math.round(rect.left), y: Math.round(rect.top) };
        posRef.current = origin;
        setPos(origin);
      }
      const ox = origin?.x ?? 0;
      const oy = origin?.y ?? 0;

      dragging.current = true;
      dragStart.current = { mx: e.clientX, my: e.clientY, ox, oy };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const onMove = (me: PointerEvent) => {
        if (!dragging.current) return;
        const dx = me.clientX - dragStart.current.mx;
        const dy = me.clientY - dragStart.current.my;
        const box = panelRef.current?.getBoundingClientRect();
        const w = box?.width ?? 320;
        const h = box?.height ?? 400;
        const maxX = window.innerWidth - w - EDGE_MARGIN;
        const maxY = window.innerHeight - h - EDGE_MARGIN;
        const next = {
          x: Math.round(Math.max(EDGE_MARGIN, Math.min(maxX, dragStart.current.ox + dx))),
          y: Math.round(Math.max(EDGE_MARGIN, Math.min(maxY, dragStart.current.oy + dy))),
        };
        posRef.current = next;
        setPos(next);
      };

      const onUp = () => {
        dragging.current = false;
        persist(posRef.current);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [panelRef, persist],
  );

  const dock = useCallback(() => {
    posRef.current = null;
    setPos(null);
    persist(null);
  }, [persist]);

  return { pos, isFloating: pos !== null, onPointerDown, dock };
}
