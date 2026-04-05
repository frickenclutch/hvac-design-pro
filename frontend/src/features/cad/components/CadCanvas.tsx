import { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { useCadStore } from '../store/useCadStore';
import type { WallMaterial } from '../store/useCadStore';

interface DrawingState {
  active: boolean;
  ghostLine: fabric.Line | null;
  startX: number;
  startY: number;
}

export default function CadCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);

  // Use a ref so the drawing state machine is accessible across both useEffects
  // without triggering re-renders or stale-closure issues.
  const drawingRef = useRef<DrawingState>({
    active: false,
    ghostLine: null,
    startX: 0,
    startY: 0,
  });

  const { activeTool, setZoom, setPanOffset, setSelectedObject, setCanvas } = useCadStore();

  // ── Main canvas setup (runs once) ─────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;

    const drawing = drawingRef.current;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#0f172a',
      selection: true,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
    });

    fabricRef.current = canvas;
    setCanvas(canvas);

    // ── Dot grid ──────────────────────────────────────────────────────────
    const renderGrid = () => {
      const ctx = canvas.getContext();
      const vpt = canvas.viewportTransform;
      if (!vpt || !ctx) return;

      const zoom = canvas.getZoom();
      const spacing = 40 * zoom;
      const offsetX = ((vpt[4] % spacing) + spacing) % spacing;
      const offsetY = ((vpt[5] % spacing) + spacing) % spacing;

      ctx.save();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
      for (let x = offsetX; x < canvas.width!; x += spacing) {
        for (let y = offsetY; y < canvas.height!; y += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, Math.min(1.5, 1.5 * zoom), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };

    canvas.on('after:render', renderGrid);

    // ── Helpers ───────────────────────────────────────────────────────────
    const snapToGrid = (worldX: number, worldY: number) => {
      const { gridSnapEnabled, projectScale } = useCadStore.getState();
      if (!gridSnapEnabled) return { x: worldX, y: worldY };
      const g = projectScale.pxPerFt;
      return {
        x: Math.round(worldX / g) * g,
        y: Math.round(worldY / g) * g,
      };
    };

    const computeLengthFt = (x1: number, y1: number, x2: number, y2: number): number => {
      const { projectScale } = useCadStore.getState();
      return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / projectScale.pxPerFt;
    };

    const cancelDrawing = () => {
      if (drawing.ghostLine) {
        canvas.remove(drawing.ghostLine);
        drawing.ghostLine = null;
      }
      drawing.active = false;
      useCadStore.getState().setDrawingInfo(null);
      canvas.requestRenderAll();
    };

    const createGhostLine = (x: number, y: number): fabric.Line => {
      const ghost = new fabric.Line([x, y, x, y], {
        stroke: '#38bdf8',
        strokeWidth: 3,
        strokeDashArray: [8, 5],
        selectable: false,
        evented: false,
        name: '__ghost_wall__',
        opacity: 0.9,
        strokeLineCap: 'round',
      });
      canvas.add(ghost);
      return ghost;
    };

    // ── Zoom ──────────────────────────────────────────────────────────────
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.min(20, Math.max(0.1, zoom));
      canvas.zoomToPoint(new fabric.Point(opt.e.offsetX, opt.e.offsetY), zoom);
      setZoom(zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // ── Mouse events (pan + wall drawing combined) ─────────────────────────
    let isDragging = false;
    let lastPosX = 0;
    let lastPosY = 0;

    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent;
      const { activeTool: tool, addWall, setSelectedWallId } = useCadStore.getState();
      const isPanMode = tool === 'pan' || evt.button === 1;

      // ─ Pan mode ─────────────────────────────────────────────────────────
      if (isPanMode) {
        isDragging = true;
        canvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        canvas.defaultCursor = 'grabbing';
        return;
      }

      // ─ Wall draw mode ───────────────────────────────────────────────────
      if (tool === 'draw_wall' && evt.button === 0) {
        const ptr = canvas.getScenePoint(evt);
        const snapped = snapToGrid(ptr.x, ptr.y);

        if (!drawing.active) {
          // First click — start ghost
          drawing.active = true;
          drawing.startX = snapped.x;
          drawing.startY = snapped.y;
          drawing.ghostLine = createGhostLine(snapped.x, snapped.y);
        } else {
          // Second click — commit wall
          const { startX, startY } = drawing;
          const endX = snapped.x;
          const endY = snapped.y;

          if (drawing.ghostLine) canvas.remove(drawing.ghostLine);
          drawing.ghostLine = null;

          const lengthFt = computeLengthFt(startX, startY, endX, endY);

          if (lengthFt >= 0.1) {
            const wallId = `wall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            const permanentLine = new fabric.Line([startX, startY, endX, endY], {
              stroke: '#34d399',
              strokeWidth: 8,
              strokeLineCap: 'round',
              selectable: true,
              evented: true,
              name: wallId,
              hasControls: false,
              hasBorders: false,
              lockMovementX: true,
              lockMovementY: true,
            });
            canvas.add(permanentLine);

            addWall({
              id: wallId,
              x1: startX,
              y1: startY,
              x2: endX,
              y2: endY,
              thicknessIn: 3.5,
              rValue: 19,
              material: 'insulated_stud' as WallMaterial,
              fabricId: wallId,
            });

            // Chain mode: start a new ghost from the endpoint
            drawing.startX = endX;
            drawing.startY = endY;
            drawing.ghostLine = createGhostLine(endX, endY);
          } else {
            // Too short — cancel silently
            drawing.active = false;
            useCadStore.getState().setDrawingInfo(null);
          }

          canvas.requestRenderAll();
        }
        return;
      }

      // ─ Select mode — detect wall clicks ─────────────────────────────────
      if (tool === 'select') {
        const target = opt.target as any;
        if (target && target.name?.startsWith('wall-')) {
          setSelectedWallId(target.name);
        } else if (!target) {
          setSelectedWallId(null);
        }
      }
    });

    canvas.on('mouse:move', (opt) => {
      const evt = opt.e as MouseEvent;
      const { activeTool: tool, setDrawingInfo } = useCadStore.getState();

      // Pan dragging
      if (isDragging) {
        const vpt = canvas.viewportTransform;
        if (!vpt) return;
        vpt[4] += evt.clientX - lastPosX;
        vpt[5] += evt.clientY - lastPosY;
        canvas.requestRenderAll();
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        setPanOffset({ x: vpt[4], y: vpt[5] });
        return;
      }

      // Ghost line update
      if (tool === 'draw_wall' && drawing.active && drawing.ghostLine) {
        const ptr = canvas.getScenePoint(evt);
        const snapped = snapToGrid(ptr.x, ptr.y);

        drawing.ghostLine.set({ x2: snapped.x, y2: snapped.y });
        canvas.requestRenderAll();

        const lengthFt = computeLengthFt(drawing.startX, drawing.startY, snapped.x, snapped.y);

        // Compute screen-space position for the HUD overlay
        const zoom = canvas.getZoom();
        const vpt = canvas.viewportTransform!;
        const screenX = snapped.x * zoom + vpt[4];
        const screenY = snapped.y * zoom + vpt[5];

        setDrawingInfo({ isDrawing: true, lengthFt, screenX, screenY });
      }
    });

    canvas.on('mouse:up', () => {
      if (isDragging) {
        canvas.setViewportTransform(canvas.viewportTransform!);
        isDragging = false;
        canvas.selection = useCadStore.getState().activeTool === 'select';
        const active = useCadStore.getState().activeTool;
        canvas.defaultCursor =
          active === 'pan' ? 'grab' : active === 'draw_wall' ? 'crosshair' : 'default';
      }
    });

    // ── Selection syncing ────────────────────────────────────────────────
    canvas.on('selection:created', (e) => {
      const obj = (e.selected?.[0] as any) ?? null;
      setSelectedObject(obj);
      if (obj?.name?.startsWith('wall-')) {
        useCadStore.getState().setSelectedWallId(obj.name);
      }
    });
    canvas.on('selection:updated', (e) => {
      const obj = (e.selected?.[0] as any) ?? null;
      setSelectedObject(obj);
      if (obj?.name?.startsWith('wall-')) {
        useCadStore.getState().setSelectedWallId(obj.name);
      }
    });
    canvas.on('selection:cleared', () => {
      setSelectedObject(null);
      useCadStore.getState().setSelectedWallId(null);
    });

    // ── Keyboard shortcuts + ESC ─────────────────────────────────────────
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC cancels active drawing
      if (e.key === 'Escape') {
        cancelDrawing();
        return;
      }
      // Tool shortcuts (only when not in a text input)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') useCadStore.getState().setActiveTool('select');
        if (e.key === 'h' || e.key === 'H') useCadStore.getState().setActiveTool('pan');
        if (e.key === 'w' || e.key === 'W') useCadStore.getState().setActiveTool('draw_wall');
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // ── Resize ───────────────────────────────────────────────────────────
    const handleResize = () => {
      canvas.setDimensions({ width: window.innerWidth, height: window.innerHeight });
      canvas.requestRenderAll();
    };
    window.addEventListener('resize', handleResize);

    canvas.requestRenderAll();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync cursor + cancel drawing when tool changes ─────────────────────────
  useEffect(() => {
    const cvs = fabricRef.current;
    const drawing = drawingRef.current;
    if (!cvs) return;

    // If we switch away from draw_wall mid-draw, clean up the ghost line
    if (activeTool !== 'draw_wall' && drawing.active) {
      if (drawing.ghostLine) {
        cvs.remove(drawing.ghostLine);
        drawing.ghostLine = null;
      }
      drawing.active = false;
      useCadStore.getState().setDrawingInfo(null);
      cvs.requestRenderAll();
    }

    if (activeTool === 'pan') {
      cvs.defaultCursor = 'grab';
      cvs.selection = false;
    } else if (activeTool === 'draw_wall') {
      cvs.defaultCursor = 'crosshair';
      cvs.selection = false;
    } else {
      cvs.defaultCursor = 'default';
      cvs.selection = true;
    }
  }, [activeTool]);

  return (
    <div className="absolute inset-0 z-0 bg-slate-900 overflow-hidden">
      <canvas ref={canvasRef} />
    </div>
  );
}
