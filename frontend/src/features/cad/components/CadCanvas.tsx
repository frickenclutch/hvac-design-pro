import { useEffect, useRef, useCallback } from 'react';
import * as fabric from 'fabric';
import { useCadStore } from '../store/useCadStore';
import type { WallMaterial, WallSegment, Opening, HvacUnit, PipeMaterial, PipeSegment, Annotation, UnderlayImage } from '../store/useCadStore';
import { showSnapPulse, showPlacementConfirm, triggerHapticVibration } from '../utils/haptics';

// ── Drawing state machine ──────────────────────────────────────────────────────
interface DrawingState {
  active: boolean;
  ghostLine: fabric.Line | null;
  startX: number;
  startY: number;
}

// ── Fabric object name prefixes ────────────────────────────────────────────────
const PREFIX = {
  wall: 'wall-',
  opening: 'opening-',
  hvac: 'hvac-',
  pipe: 'pipe-',
  annotation: 'ann-',
  room: 'room-',
  ghost: '__ghost_',
  underlay: 'underlay-',
};

// ── HVAC symbol dimensions ─────────────────────────────────────────────────────
const HVAC_SIZE = 28;
const HVAC_COLORS: Record<string, string> = {
  supply_register: '#22d3ee',
  return_grille: '#a78bfa',
  air_handler: '#f472b6',
  condenser: '#fb923c',
  thermostat: '#facc15',
  duct_run: '#94a3b8',
};

const PIPE_COLORS: Record<PipeMaterial, string> = {
  copper_liquid: '#fca5a5',
  copper_suction: '#ef4444',
  pvc_condensate: '#ffffff',
  gas_black_iron: '#64748b',
};

export default function CadCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const drawingRef = useRef<DrawingState>({ active: false, ghostLine: null, startX: 0, startY: 0 });
  const placementGhostRef = useRef<fabric.Object | null>(null);

  const { activeTool, setZoom, setPanOffset, setSelectedObject, setCanvas } = useCadStore();

  // Label inline edit overlay state
  const labelOverlayRef = useRef<HTMLDivElement | null>(null);

  // Ref to hold syncFloorToCanvas so image handlers can call it without circular deps
  const syncRef = useRef<((c: fabric.Canvas) => void) | null>(null);

  // ── Process an image file into an underlay ─────────────────────────────────
  const processImageFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (file.type === 'application/pdf') {
      alert('PDF import is not yet supported. Please convert your PDF to PNG or JPG first.');
      return;
    }
    if (!validTypes.includes(file.type)) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = () => {
        // Proportional sizing: fit to max 600px width or 400px height
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const maxW = 600;
        const maxH = 400;
        if (w > maxW) { const r = maxW / w; w *= r; h *= r; }
        if (h > maxH) { const r = maxH / h; w *= r; h *= r; }

        // Center on visible canvas area
        const canvas = fabricRef.current;
        let cx = 300, cy = 300;
        if (canvas) {
          const vpt = canvas.viewportTransform;
          const zoom = canvas.getZoom();
          if (vpt) {
            cx = ((canvas.width ?? 800) / 2 - vpt[4]) / zoom;
            cy = ((canvas.height ?? 600) / 2 - vpt[5]) / zoom;
          }
        }

        const underlayId = `underlay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const underlayImg: UnderlayImage = {
          id: underlayId,
          name: file.name,
          dataUrl,
          x: cx - w / 2,
          y: cy - h / 2,
          width: w,
          height: h,
          rotation: 0,
          opacity: 1,
          locked: false,
        };

        const state = useCadStore.getState();
        state.addUnderlay(underlayImg);
        state.markDirty();
        if (fabricRef.current && syncRef.current) syncRef.current(fabricRef.current);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      processImageFile(files[i]);
    }
  }, [processImageFile]);

  // ── Snap helper ────────────────────────────────────────────────────────────
  const lastSnapRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });
  const snapToGrid = useCallback((worldX: number, worldY: number) => {
    const { gridSnapEnabled, projectScale } = useCadStore.getState();
    if (!gridSnapEnabled) return { x: worldX, y: worldY };
    const g = projectScale.pxPerFt;
    const snapped = { x: Math.round(worldX / g) * g, y: Math.round(worldY / g) * g };
    // Fire haptic pulse when snap position changes
    if (snapped.x !== lastSnapRef.current.x || snapped.y !== lastSnapRef.current.y) {
      lastSnapRef.current = snapped;
      const fc = fabricRef.current;
      if (fc) {
        const zoom = fc.getZoom();
        const vpt = fc.viewportTransform!;
        const screenX = snapped.x * zoom + vpt[4];
        const screenY = snapped.y * zoom + vpt[5];
        const container = fc.getSelectionElement()?.parentElement;
        if (container) showSnapPulse(screenX, screenY, container);
        triggerHapticVibration('snap');
      }
    }
    return snapped;
  }, []);

  const computeLengthFt = useCallback((x1: number, y1: number, x2: number, y2: number): number => {
    const { projectScale } = useCadStore.getState();
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / projectScale.pxPerFt;
  }, []);

  // ── Find nearest wall for opening placement ───────────────────────────────
  const findNearestWall = useCallback((px: number, py: number, maxDist = 30) => {
    const state = useCadStore.getState();
    const floor = state.floors.find(f => f.id === state.activeFloorId);
    if (!floor) return null;

    let best: { wall: WallSegment; t: number; dist: number } | null = null;

    for (const w of floor.walls) {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;
      let t = ((px - w.x1) * dx + (py - w.y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const cx = w.x1 + t * dx;
      const cy = w.y1 + t * dy;
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dist < maxDist && (!best || dist < best.dist)) {
        best = { wall: w, t, dist };
      }
    }
    return best;
  }, []);

  // ── Create fabric objects ─────────────────────────────────────────────────
  const createWallLine = useCallback((w: WallSegment): fabric.Line => {
    const state = useCadStore.getState();
    let strokeColor = state.wallColor;

    // Thermal overlay: color walls by R-value grade
    if (state.thermalOverlayEnabled) {
      if (w.rValue >= 21) strokeColor = '#22c55e';      // excellent
      else if (w.rValue >= 13) strokeColor = '#3b82f6';  // good
      else if (w.rValue >= 7) strokeColor = '#f59e0b';   // fair
      else strokeColor = '#ef4444';                       // poor
    }

    return new fabric.Line([w.x1, w.y1, w.x2, w.y2], {
      stroke: strokeColor,
      strokeWidth: state.thermalOverlayEnabled ? 10 : 8,
      strokeLineCap: 'round',
      selectable: true,
      evented: true,
      name: w.fabricId,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
    });
  }, []);

  const createOpeningShape = useCallback((o: Opening, walls: WallSegment[]): fabric.Object | null => {
    const wall = walls.find(w => w.id === o.wallId);
    if (!wall) return null;
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    const cx = wall.x1 + o.positionAlongWall * dx;
    const cy = wall.y1 + o.positionAlongWall * dy;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const widthPx = (o.widthIn / 12) * useCadStore.getState().projectScale.pxPerFt;

    if (o.type === 'window') {
      const rect = new fabric.Rect({
        width: widthPx,
        height: 8,
        fill: useCadStore.getState().openingColor + '4d',
        stroke: useCadStore.getState().openingColor,
        strokeWidth: 2,
        angle,
        originX: 'center',
        originY: 'center',
        left: cx,
        top: cy,
        selectable: true,
        evented: true,
        name: `${PREFIX.opening}${o.id}`,
        hasControls: false,
      });
      return rect;
    }

    if (o.type === 'door' || o.type === 'sliding_door') {
      const group = new fabric.Group([], {
        left: cx,
        top: cy,
        originX: 'center',
        originY: 'center',
        angle,
        selectable: true,
        evented: true,
        // @ts-ignore
        name: `${PREFIX.opening}${o.id}`,
        hasControls: false,
      });

      // Door gap (break in wall)
      const gap = new fabric.Rect({
        left: -widthPx / 2,
        top: -5,
        width: widthPx,
        height: 10,
        fill: '#0f172a',
        stroke: 'transparent',
      });

      // Arc swing indicator
      const arc = new fabric.Circle({
        left: o.swingDirection === 'right' ? 0 : -widthPx,
        top: -widthPx,
        radius: widthPx,
        startAngle: o.swingDirection === 'right' ? 0 : 270,
        endAngle: o.swingDirection === 'right' ? 90 : 360,
        fill: 'transparent',
        stroke: '#fb923c',
        strokeWidth: 1.5,
        strokeDashArray: [4, 3],
      });

      group.add(gap, arc);
      return group;
    }

    return null;
  }, []);

  const createHvacShape = useCallback((unit: HvacUnit): fabric.Object => {
    const color = HVAC_COLORS[unit.type] || '#94a3b8';
    const size = HVAC_SIZE;

    if (unit.type === 'supply_register' || unit.type === 'return_grille') {
      // Rect with lines
      const rect = new fabric.Rect({
        left: unit.x - size / 2,
        top: unit.y - size / 2,
        width: size,
        height: size,
        fill: `${color}20`,
        stroke: color,
        strokeWidth: 2,
        rx: 4,
        ry: 4,
      });
      const lines: fabric.Line[] = [];
      const count = unit.type === 'supply_register' ? 3 : 2;
      for (let i = 1; i <= count; i++) {
        const y = unit.y - size / 2 + (size / (count + 1)) * i;
        lines.push(new fabric.Line([unit.x - size / 3, y, unit.x + size / 3, y], {
          stroke: color,
          strokeWidth: 1.5,
        }));
      }
      const group = new fabric.Group([rect, ...lines], {
        selectable: true,
        evented: true,
        // @ts-ignore
        name: `${PREFIX.hvac}${unit.id}`,
        hasControls: false,
        angle: unit.rotation,
      });
      return group;
    }

    if (unit.type === 'air_handler') {
      const circle = new fabric.Circle({
        left: unit.x - size / 2,
        top: unit.y - size / 2,
        radius: size / 2,
        fill: `${color}20`,
        stroke: color,
        strokeWidth: 2,
      });
      const fan1 = new fabric.Line([unit.x - 6, unit.y - 8, unit.x + 6, unit.y + 8], { stroke: color, strokeWidth: 1.5 });
      const fan2 = new fabric.Line([unit.x + 6, unit.y - 8, unit.x - 6, unit.y + 8], { stroke: color, strokeWidth: 1.5 });
      return new fabric.Group([circle, fan1, fan2], {
        selectable: true,
        evented: true,
        // @ts-ignore
        name: `${PREFIX.hvac}${unit.id}`,
        hasControls: false,
        angle: unit.rotation,
      });
    }

    if (unit.type === 'thermostat') {
      const outer = new fabric.Circle({
        left: unit.x - 10,
        top: unit.y - 10,
        radius: 10,
        fill: `${color}30`,
        stroke: color,
        strokeWidth: 2,
      });
      const inner = new fabric.Circle({
        left: unit.x - 4,
        top: unit.y - 4,
        radius: 4,
        fill: color,
      });
      return new fabric.Group([outer, inner], {
        selectable: true,
        evented: true,
        // @ts-ignore
        name: `${PREFIX.hvac}${unit.id}`,
        hasControls: false,
      });
    }

    // Default box for condenser, duct_run, etc.
    const rect = new fabric.Rect({
      left: unit.x - size / 2,
      top: unit.y - size / 2,
      width: size,
      height: size,
      fill: `${color}20`,
      stroke: color,
      strokeWidth: 2,
      rx: 3,
      ry: 3,
    });
    return new fabric.Group([rect], {
      selectable: true,
      evented: true,
      // @ts-ignore
      name: `${PREFIX.hvac}${unit.id}`,
      hasControls: false,
    });
  }, []);

  const createPipeLine = useCallback((p: PipeSegment): fabric.Line => {
    const color = PIPE_COLORS[p.material] || '#cbd5e1';
    
    return new fabric.Line([p.x1, p.y1, p.x2, p.y2], {
      stroke: color,
      strokeWidth: p.diameterIn * 4, // scale diameter to visual width
      strokeLineCap: 'round',
      selectable: true,
      evented: true,
      name: `${PREFIX.pipe}${p.id}`,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
    });
  }, []);

  const createAnnotationShape = useCallback((ann: Annotation): fabric.Object => {
    if (ann.type === 'dimension') {
      return new fabric.FabricText(ann.text, {
        left: ann.x,
        top: ann.y,
        fontSize: 12,
        fontFamily: 'monospace',
        fill: '#f59e0b',
        angle: ann.rotation ?? 0,
        selectable: true,
        evented: true,
        name: `${PREFIX.annotation}${ann.id}`,
      });
    }

    // Label / note / leader — apply custom text styling
    const textObj = new fabric.FabricText(ann.text, {
      left: ann.x,
      top: ann.y,
      fontSize: ann.fontSize ?? 14,
      fontFamily: ann.fontFamily ?? 'sans-serif',
      fill: ann.fontColor ?? '#e2e8f0',
      fontWeight: ann.fontWeight ?? 'normal',
      fontStyle: ann.fontStyle ?? 'normal',
      textAlign: ann.textAlign ?? 'left',
      angle: ann.rotation ?? 0,
      scaleX: ann.scaleX ?? 1,
      scaleY: ann.scaleY ?? 1,
      backgroundColor: ann.backgroundColor ?? '',
      selectable: true,
      evented: true,
      name: `${PREFIX.annotation}${ann.id}`,
    });

    if (ann.borderColor) {
      textObj.set({
        stroke: ann.borderColor,
        strokeWidth: 1,
      });
    }

    return textObj;
  }, []);

  // ── Render all floor objects onto canvas ───────────────────────────────────
  const syncFloorToCanvas = useCallback((canvas: fabric.Canvas) => {
    const state = useCadStore.getState();
    const floor = state.floors.find(f => f.id === state.activeFloorId);
    if (!floor) return;

    // Remove all existing CAD objects (keep grid/ghost)
    const toRemove = canvas.getObjects().filter(obj => {
      const n = (obj as any).name as string | undefined;
      if (!n) return false;
      return n.startsWith(PREFIX.wall) || n.startsWith(PREFIX.opening) ||
             n.startsWith(PREFIX.hvac) || n.startsWith(PREFIX.pipe) ||
             n.startsWith(PREFIX.annotation) ||
             n.startsWith(PREFIX.room) || n.startsWith(PREFIX.underlay);
    });
    toRemove.forEach(obj => canvas.remove(obj));

    const wallsLayer = state.layers.find(l => l.id === 'walls');
    const openingsLayer = state.layers.find(l => l.id === 'openings');
    const hvacLayer = state.layers.find(l => l.id === 'hvac');
    const annotationsLayer = state.layers.find(l => l.id === 'annotations');
    const underlayLayer = state.layers.find(l => l.id === 'underlay');

    // Underlays (behind everything else)
    if (underlayLayer?.visible && floor.underlays) {
      for (const u of floor.underlays) {
        const imgEl = new Image();
        imgEl.src = u.dataUrl;
        const fImg = new fabric.FabricImage(imgEl, {
          left: u.x,
          top: u.y,
          scaleX: u.width / (imgEl.naturalWidth || u.width || 1),
          scaleY: u.height / (imgEl.naturalHeight || u.height || 1),
          angle: u.rotation,
          opacity: u.opacity * (underlayLayer.opacity ?? 1),
          selectable: !underlayLayer.locked && !u.locked,
          evented: !underlayLayer.locked && !u.locked,
          name: `${PREFIX.underlay}${u.id}`,
          hasControls: !underlayLayer.locked && !u.locked,
          hasBorders: !underlayLayer.locked && !u.locked,
          lockRotation: underlayLayer.locked || u.locked,
        });
        canvas.add(fImg);
        canvas.sendObjectToBack(fImg);
      }
    }

    // Room fills (behind everything)
    for (const room of floor.rooms) {
      // Simple centroid-based label for detected rooms
      const label = new fabric.FabricText(`${room.name}\n${room.areaSqFt.toFixed(0)} sq ft`, {
        left: room.centroid.x,
        top: room.centroid.y,
        fontSize: 11,
        fontFamily: 'monospace',
        fill: room.color,
        textAlign: 'center',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        name: `${PREFIX.room}${room.id}`,
        opacity: 0.7,
      });
      canvas.add(label);
    }

    // Walls
    if (wallsLayer?.visible) {
      for (const w of floor.walls) {
        const line = createWallLine(w);
        line.set({ opacity: wallsLayer.opacity });
        if (wallsLayer.locked) {
          line.set({ selectable: false, evented: false });
        }
        canvas.add(line);
      }
    }

    // Openings
    if (openingsLayer?.visible) {
      for (const o of floor.openings) {
        const shape = createOpeningShape(o, floor.walls);
        if (shape) {
          shape.set({ opacity: openingsLayer.opacity });
          if (openingsLayer.locked) shape.set({ selectable: false, evented: false });
          canvas.add(shape);
        }
      }
    }

    // HVAC
    if (hvacLayer?.visible) {
      for (const u of floor.hvacUnits) {
        const shape = createHvacShape(u);
        shape.set({ opacity: hvacLayer.opacity });
        if (hvacLayer.locked) shape.set({ selectable: false, evented: false });
        canvas.add(shape);
      }
    }

    // Piping
    const pipingLayer = state.layers.find(l => l.id === 'piping');
    if (pipingLayer?.visible) {
      for (const p of (floor.pipes ?? [])) {
        const line = createPipeLine(p);
        line.set({ opacity: pipingLayer.opacity });
        if (pipingLayer.locked) line.set({ selectable: false, evented: false });
        canvas.add(line);
      }
    }

    // Annotations
    if (annotationsLayer?.visible) {
      for (const a of floor.annotations) {
        const shape = createAnnotationShape(a);
        shape.set({ opacity: annotationsLayer.opacity });
        if (annotationsLayer.locked) shape.set({ selectable: false, evented: false });
        canvas.add(shape);
      }
    }

    // Render ghost floors (faded outlines of other visible floors)
    if (state.ghostingEnabled) {
      for (const otherFloor of state.floors) {
        if (otherFloor.id === state.activeFloorId || !otherFloor.isVisible) continue;
        for (const w of otherFloor.walls) {
          const ghostWall = new fabric.Line([w.x1, w.y1, w.x2, w.y2], {
            stroke: '#475569',
            strokeWidth: 4,
            strokeLineCap: 'round',
            strokeDashArray: [6, 4],
            selectable: false,
            evented: false,
            name: `${PREFIX.ghost}floor_${otherFloor.id}_${w.id}`,
            opacity: 0.3,
          });
          canvas.add(ghostWall);
          canvas.sendObjectToBack(ghostWall);
        }
      }
    }

    canvas.requestRenderAll();
  }, [createWallLine, createOpeningShape, createHvacShape, createPipeLine, createAnnotationShape]);

  // Keep ref in sync for image import handlers
  syncRef.current = syncFloorToCanvas;

  // ── Room detection algorithm ──────────────────────────────────────────────
  const detectRooms = useCallback(() => {
    const state = useCadStore.getState();
    const floor = state.floors.find(f => f.id === state.activeFloorId);
    if (!floor || floor.walls.length < 3) return;

    // Build adjacency graph from wall endpoints
    const SNAP_DIST = 15;
    const nodes: Map<string, { x: number; y: number; edges: string[] }> = new Map();

    const nodeKey = (x: number, y: number): string => {
      // Snap endpoints to merge nearby points
      const sx = Math.round(x / SNAP_DIST) * SNAP_DIST;
      const sy = Math.round(y / SNAP_DIST) * SNAP_DIST;
      return `${sx},${sy}`;
    };

    const getOrCreateNode = (x: number, y: number) => {
      const key = nodeKey(x, y);
      if (!nodes.has(key)) {
        const sx = Math.round(x / SNAP_DIST) * SNAP_DIST;
        const sy = Math.round(y / SNAP_DIST) * SNAP_DIST;
        nodes.set(key, { x: sx, y: sy, edges: [] });
      }
      return key;
    };

    // Build graph
    for (const w of floor.walls) {
      const k1 = getOrCreateNode(w.x1, w.y1);
      const k2 = getOrCreateNode(w.x2, w.y2);
      if (k1 === k2) continue;
      const n1 = nodes.get(k1)!;
      const n2 = nodes.get(k2)!;
      if (!n1.edges.includes(k2)) n1.edges.push(k2);
      if (!n2.edges.includes(k1)) n2.edges.push(k1);
    }

    // Find minimal cycles using right-hand walk
    const visited = new Set<string>();
    const rooms: Array<{ keys: string[] }> = [];

    for (const [startKey, startNode] of nodes.entries()) {
      if (startNode.edges.length < 2) continue;

      for (const firstNeighbor of startNode.edges) {
        const edgeKey = `${startKey}->${firstNeighbor}`;
        if (visited.has(edgeKey)) continue;

        const path: string[] = [startKey];
        let prev = startKey;
        let curr = firstNeighbor;
        let found = false;

        for (let steps = 0; steps < 20; steps++) {
          path.push(curr);
          visited.add(`${prev}->${curr}`);

          if (curr === startKey && path.length >= 4) {
            found = true;
            break;
          }

          const node = nodes.get(curr);
          if (!node || node.edges.length < 2) break;

          // Pick next edge by smallest clockwise angle
          const fromAngle = Math.atan2(
            nodes.get(prev)!.y - node.y,
            nodes.get(prev)!.x - node.x
          );

          let bestAngle = Infinity;
          let bestNext = '';
          for (const neighbor of node.edges) {
            if (neighbor === prev && node.edges.length > 1) continue;
            const nNode = nodes.get(neighbor)!;
            let angle = Math.atan2(nNode.y - node.y, nNode.x - node.x) - fromAngle;
            if (angle <= 0) angle += Math.PI * 2;
            if (angle < bestAngle) {
              bestAngle = angle;
              bestNext = neighbor;
            }
          }

          if (!bestNext) break;
          prev = curr;
          curr = bestNext;
        }

        if (found && path.length >= 4) {
          const sorted = [...path].sort().join('|');
          if (!rooms.some(r => [...r.keys].sort().join('|') === sorted)) {
            rooms.push({ keys: path.slice(0, -1) }); // remove duplicate start
          }
        }
      }
    }

    // Convert graph cycles to DetectedRoom
    const colors = ['#22d3ee40', '#a78bfa40', '#fb923c40', '#34d39940', '#f472b640', '#facc1540'];
    const { projectScale } = state;

    const detectedRooms = rooms.map((room, i) => {
      const points = room.keys.map(k => nodes.get(k)!);
      const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
      const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

      // Shoelace area
      let area = 0;
      let perim = 0;
      for (let j = 0; j < points.length; j++) {
        const p1 = points[j];
        const p2 = points[(j + 1) % points.length];
        area += p1.x * p2.y - p2.x * p1.y;
        perim += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      }
      area = Math.abs(area) / 2;

      const pxPerFt = projectScale.pxPerFt;
      return {
        id: `room-${Date.now()}-${i}`,
        name: `Room ${i + 1}`,
        wallIds: [] as string[],
        areaSqFt: area / (pxPerFt * pxPerFt),
        perimeterFt: perim / pxPerFt,
        centroid: { x: cx, y: cy },
        color: colors[i % colors.length],
      };
    });

    useCadStore.getState().setDetectedRooms(detectedRooms);
    if (fabricRef.current) syncFloorToCanvas(fabricRef.current);
  }, [syncFloorToCanvas]);

  // ── Main canvas setup (runs once) ─────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;

    const drawing = drawingRef.current;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: useCadStore.getState().canvasBgColor,
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
    const cancelDrawing = () => {
      if (drawing.ghostLine) {
        canvas.remove(drawing.ghostLine);
        drawing.ghostLine = null;
      }
      drawing.active = false;
      useCadStore.getState().setDrawingInfo(null);
      // Remove placement ghost
      if (placementGhostRef.current) {
        canvas.remove(placementGhostRef.current);
        placementGhostRef.current = null;
      }
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

    // ── Push undo history wrapper ────────────────────────────────────────
    const pushWallHistory = (type: string, before: WallSegment[], after: WallSegment[]) => {
      const state = useCadStore.getState();
      state.pushHistory({
        type,
        floorId: state.activeFloorId,
        before: { walls: before },
        after: { walls: after },
        timestamp: Date.now(),
      });
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

    // ── Mouse events ─────────────────────────────────────────────────────
    let isDragging = false;
    let lastPosX = 0;
    let lastPosY = 0;

    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent;
      const state = useCadStore.getState();
      const tool = state.activeTool;
      const isPanMode = tool === 'pan' || evt.button === 1;

      // ─ Pan mode ─────────────────────────────────────────────────────
      if (isPanMode) {
        isDragging = true;
        canvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        canvas.defaultCursor = 'grabbing';
        return;
      }

      const ptr = canvas.getScenePoint(evt);
      const snapped = snapToGrid(ptr.x, ptr.y);

      // ─ Right-click ends wall/pipe chain or cancels placement ───────
      if (evt.button === 2) {
        if ((tool === 'draw_wall' || tool === 'draw_pipe') && drawing.active) {
          // End chain, return to select
          if (drawing.ghostLine) canvas.remove(drawing.ghostLine);
          drawing.ghostLine = null;
          drawing.active = false;
          state.setDrawingInfo(null);
          state.setActiveTool('select');
          canvas.requestRenderAll();
        } else if (tool !== 'select') {
           // Cancel any other placement tool
           cancelDrawing();
          state.setActiveTool('select');
        }
        return;
      }

      // ─ Wall draw mode ───────────────────────────────────────────────
      if (tool === 'draw_wall' && evt.button === 0) {
        if (!drawing.active) {
          drawing.active = true;
          drawing.startX = snapped.x;
          drawing.startY = snapped.y;
          drawing.ghostLine = createGhostLine(snapped.x, snapped.y);
        } else {
          const { startX, startY } = drawing;
          const endX = snapped.x;
          const endY = snapped.y;

          if (drawing.ghostLine) canvas.remove(drawing.ghostLine);
          drawing.ghostLine = null;

          const lengthFt = computeLengthFt(startX, startY, endX, endY);

          if (lengthFt >= 0.1) {
            const wallId = `wall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const floor = state.floors.find(f => f.id === state.activeFloorId);
            const wallsBefore = floor ? [...floor.walls] : [];

            const newWall: WallSegment = {
              id: wallId,
              x1: startX,
              y1: startY,
              x2: endX,
              y2: endY,
              thicknessIn: 3.5,
              rValue: 19,
              material: 'insulated_stud' as WallMaterial,
              fabricId: wallId,
            };

            state.addWall(newWall);
            state.markDirty();

            // Push history
            const updatedFloor = useCadStore.getState().floors.find(f => f.id === state.activeFloorId);
            pushWallHistory('add_wall', wallsBefore, updatedFloor?.walls ?? []);

            // Re-sync canvas
            syncFloorToCanvas(canvas);

            // Haptic feedback for wall placement
            {
              const zoom = canvas.getZoom();
              const vpt = canvas.viewportTransform!;
              const sx = endX * zoom + vpt[4];
              const sy = endY * zoom + vpt[5];
              const container = canvas.getSelectionElement()?.parentElement;
              if (container) showPlacementConfirm(sx, sy, container);
              triggerHapticVibration('place');
            }

            // Chain mode
            drawing.startX = endX;
            drawing.startY = endY;
            drawing.ghostLine = createGhostLine(endX, endY);
          } else {
            drawing.active = false;
            state.setDrawingInfo(null);
          }

          canvas.requestRenderAll();
        }
        return;
      }

      // ─ Pipe draw mode ───────────────────────────────────────────────
      if (tool === 'draw_pipe' && evt.button === 0) {
        if (!drawing.active) {
          drawing.active = true;
          drawing.startX = snapped.x;
          drawing.startY = snapped.y;
          drawing.ghostLine = createGhostLine(snapped.x, snapped.y);
          drawing.ghostLine.set({ stroke: '#ec4899', strokeWidth: 4 });
        } else {
          const { startX, startY } = drawing;
          const endX = snapped.x;
          const endY = snapped.y;

          if (drawing.ghostLine) canvas.remove(drawing.ghostLine);
          drawing.ghostLine = null;

          const lengthFt = computeLengthFt(startX, startY, endX, endY);

          if (lengthFt >= 0.1) {
            const pipeId = `pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            
            const newPipe: PipeSegment = {
              id: pipeId,
              x1: startX,
              y1: startY,
              x2: endX,
              y2: endY,
              diameterIn: 0.75, // default 3/4"
              material: 'copper_liquid', // default
              fabricId: pipeId,
            };

            state.addPipe(newPipe);
            state.markDirty();
            syncFloorToCanvas(canvas);

            // Chain mode
            drawing.startX = endX;
            drawing.startY = endY;
            drawing.ghostLine = createGhostLine(endX, endY);
            drawing.ghostLine.set({ stroke: '#ec4899', strokeWidth: 4 });
          } else {
            drawing.active = false;
            state.setDrawingInfo(null);
          }

          canvas.requestRenderAll();
        }
        return;
      }

      // ─ Window/Door placement (place one, return to select) ─────────
      if ((tool === 'place_window' || tool === 'place_door') && evt.button === 0) {
        const hit = findNearestWall(snapped.x, snapped.y, 40);
        if (hit) {
          const openingId = `opening-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const isWindow = tool === 'place_window';
          const opening: Opening = {
            id: openingId,
            type: isWindow ? 'window' : 'door',
            wallId: hit.wall.id,
            positionAlongWall: hit.t,
            widthIn: isWindow ? 36 : 32,
            heightIn: isWindow ? 48 : 80,
            uFactor: isWindow ? 0.3 : undefined,
            shgc: isWindow ? 0.25 : undefined,
            swingDirection: isWindow ? undefined : 'left',
            fabricId: `${PREFIX.opening}${openingId}`,
          };
          state.addOpening(opening);
          state.markDirty();
          syncFloorToCanvas(canvas);

          // Haptic feedback for opening placement
          const zoom = canvas.getZoom();
          const vpt = canvas.viewportTransform!;
          const sx = snapped.x * zoom + vpt[4];
          const sy = snapped.y * zoom + vpt[5];
          const container = canvas.getSelectionElement()?.parentElement;
          if (container) showPlacementConfirm(sx, sy, container);
          triggerHapticVibration('place');
        }
        // Return to select after placing
        state.setActiveTool('select');
        return;
      }

      // ─ HVAC placement (place one, return to select) ────────────────
      if (tool === 'place_hvac' && evt.button === 0) {
        const unitId = `hvac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const unit: HvacUnit = {
          id: unitId,
          type: 'supply_register',
          x: snapped.x,
          y: snapped.y,
          rotation: 0,
          cfm: 100,
          label: 'Supply Register',
          fabricId: `${PREFIX.hvac}${unitId}`,
        };
        state.addHvacUnit(unit);
        state.markDirty();
        syncFloorToCanvas(canvas);

        // Haptic feedback for HVAC placement
        {
          const zoom = canvas.getZoom();
          const vpt = canvas.viewportTransform!;
          const sx = snapped.x * zoom + vpt[4];
          const sy = snapped.y * zoom + vpt[5];
          const container = canvas.getSelectionElement()?.parentElement;
          if (container) showPlacementConfirm(sx, sy, container);
          triggerHapticVibration('place');
        }

        // Return to select after placing
        state.setActiveTool('select');
        return;
      }

      // ─ Label placement with inline text input ────────────────────
      if (tool === 'add_label' && evt.button === 0) {
        // Compute screen coordinates for the overlay
        const zoom = canvas.getZoom();
        const vpt = canvas.viewportTransform!;
        const screenX = snapped.x * zoom + vpt[4];
        const screenY = snapped.y * zoom + vpt[5];
        const worldX = snapped.x;
        const worldY = snapped.y;

        // Remove any existing label overlay
        if (labelOverlayRef.current) {
          labelOverlayRef.current.remove();
          labelOverlayRef.current = null;
        }

        // Create inline text input overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;z-index:9999;`;
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Label';
        input.style.cssText = `background:rgba(15,23,42,0.95);color:#e2e8f0;border:1px solid rgba(52,211,153,0.5);border-radius:6px;padding:4px 8px;font-size:14px;font-family:sans-serif;outline:none;min-width:120px;box-shadow:0 0 15px rgba(16,185,129,0.2);`;
        overlay.appendChild(input);
        document.body.appendChild(overlay);
        labelOverlayRef.current = overlay;
        input.focus();

        const commitLabel = (text: string) => {
          if (overlay.parentNode) overlay.remove();
          labelOverlayRef.current = null;
          const finalText = text.trim() || 'Label';
          const annId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const annotation: Annotation = {
            id: annId,
            type: 'label',
            x: worldX,
            y: worldY,
            text: finalText,
            fabricId: `${PREFIX.annotation}${annId}`,
          };
          const st = useCadStore.getState();
          st.addAnnotation(annotation);
          st.markDirty();
          syncFloorToCanvas(canvas);
          st.setActiveTool('select');
        };

        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); commitLabel(input.value); }
          if (ke.key === 'Escape') { overlay.remove(); labelOverlayRef.current = null; useCadStore.getState().setActiveTool('select'); }
        });
        input.addEventListener('blur', () => { if (overlay.parentNode) commitLabel(input.value); });
        return;
      }

      // ─ Dimension placement ─────────────────────────────────────────
      if (tool === 'add_dimension' && evt.button === 0) {
        // For dimensions, we use the same two-click pattern as walls
        if (!drawing.active) {
          drawing.active = true;
          drawing.startX = snapped.x;
          drawing.startY = snapped.y;
          drawing.ghostLine = createGhostLine(snapped.x, snapped.y);
          (drawing.ghostLine as any).set({ stroke: '#f59e0b', strokeDashArray: [4, 3] });
        } else {
          if (drawing.ghostLine) canvas.remove(drawing.ghostLine);
          drawing.ghostLine = null;

          const lengthFt = computeLengthFt(drawing.startX, drawing.startY, snapped.x, snapped.y);
          if (lengthFt >= 0.1) {
            const midX = (drawing.startX + snapped.x) / 2;
            const midY = (drawing.startY + snapped.y) / 2;
            const angle = Math.atan2(snapped.y - drawing.startY, snapped.x - drawing.startX) * (180 / Math.PI);

            const annId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const annotation: Annotation = {
              id: annId,
              type: 'dimension',
              x: midX,
              y: midY - 15,
              text: `${lengthFt.toFixed(1)} ft`,
              rotation: angle,
              fabricId: `${PREFIX.annotation}${annId}`,
            };

            // Also draw the dimension line itself
            const dimLine = new fabric.Line([drawing.startX, drawing.startY, snapped.x, snapped.y], {
              stroke: '#f59e0b',
              strokeWidth: 1,
              strokeDashArray: [4, 3],
              selectable: false,
              evented: false,
              name: `${PREFIX.annotation}${annId}_line`,
            });
            canvas.add(dimLine);

            state.addAnnotation(annotation);
            state.markDirty();
            syncFloorToCanvas(canvas);
          }

          drawing.active = false;
          state.setDrawingInfo(null);
          // Return to select after placing dimension
          state.setActiveTool('select');
          canvas.requestRenderAll();
        }
        return;
      }

      // ─ Room detection (run once, return to select) ─────────────────
      if (tool === 'room_detect' && evt.button === 0) {
        detectRooms();
        state.setActiveTool('select');
        return;
      }

      // ─ Select mode ─────────────────────────────────────────────────
      if (tool === 'select') {
        const target = opt.target as any;
        if (target && target.name?.startsWith('wall-')) {
          state.setSelectedWallId(target.name);
        } else if (!target) {
          state.setSelectedWallId(null);
        }
      }
    });

    canvas.on('mouse:move', (opt) => {
      const evt = opt.e as MouseEvent;
      const state = useCadStore.getState();
      const tool = state.activeTool;

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

      const ptr = canvas.getScenePoint(evt);
      const snapped = snapToGrid(ptr.x, ptr.y);

      // Ghost line update for wall draw, pipe draw, and dimension
      if ((tool === 'draw_wall' || tool === 'draw_pipe' || tool === 'add_dimension') && drawing.active && drawing.ghostLine) {
        drawing.ghostLine.set({ x2: snapped.x, y2: snapped.y });
        canvas.requestRenderAll();

        const lengthFt = computeLengthFt(drawing.startX, drawing.startY, snapped.x, snapped.y);
        const zoom = canvas.getZoom();
        const vpt = canvas.viewportTransform!;
        const screenX = snapped.x * zoom + vpt[4];
        const screenY = snapped.y * zoom + vpt[5];
        state.setDrawingInfo({ isDrawing: true, lengthFt, screenX, screenY });
      }

      // Placement ghost for window/door (highlight nearest wall)
      if (tool === 'place_window' || tool === 'place_door') {
        if (placementGhostRef.current) {
          canvas.remove(placementGhostRef.current);
          placementGhostRef.current = null;
        }
        const hit = findNearestWall(snapped.x, snapped.y, 40);
        if (hit) {
          const w = hit.wall;
          const cx = w.x1 + hit.t * (w.x2 - w.x1);
          const cy = w.y1 + hit.t * (w.y2 - w.y1);
          const ghost = new fabric.Circle({
            left: cx,
            top: cy,
            radius: 8,
            fill: tool === 'place_window' ? 'rgba(56,189,248,0.5)' : 'rgba(251,146,60,0.5)',
            stroke: tool === 'place_window' ? '#38bdf8' : '#fb923c',
            strokeWidth: 2,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
          });
          canvas.add(ghost);
          placementGhostRef.current = ghost;
          canvas.requestRenderAll();
        }
      }

      // Placement ghost for HVAC
      if (tool === 'place_hvac') {
        if (placementGhostRef.current) {
          canvas.remove(placementGhostRef.current);
          placementGhostRef.current = null;
        }
        const ghost = new fabric.Rect({
          left: snapped.x - HVAC_SIZE / 2,
          top: snapped.y - HVAC_SIZE / 2,
          width: HVAC_SIZE,
          height: HVAC_SIZE,
          fill: 'rgba(34,211,238,0.2)',
          stroke: '#22d3ee',
          strokeWidth: 2,
          strokeDashArray: [4, 3],
          rx: 4,
          ry: 4,
          selectable: false,
          evented: false,
        });
        canvas.add(ghost);
        placementGhostRef.current = ghost;
        canvas.requestRenderAll();
      }
    });

    // ── Double-click ends wall/pipe chain ─────────────────────────
    canvas.on('mouse:dblclick', (opt) => {
      const state = useCadStore.getState();
      const tool = state.activeTool;
      if ((tool === 'draw_wall' || tool === 'draw_pipe') && drawing.active) {
        // Commit current ghost as final segment, then end chain
        const evt = opt.e as MouseEvent;
        const ptr = canvas.getScenePoint(evt);
        const snapped = snapToGrid(ptr.x, ptr.y);
        const lengthFt = computeLengthFt(drawing.startX, drawing.startY, snapped.x, snapped.y);

        if (lengthFt >= 0.1) {
          if (tool === 'draw_wall') {
            const wallId = `wall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            state.addWall({
              id: wallId,
              x1: drawing.startX, y1: drawing.startY,
              x2: snapped.x, y2: snapped.y,
              thicknessIn: 3.5, rValue: 19,
              material: 'insulated_stud' as WallMaterial,
              fabricId: wallId,
            });
          } else {
            const pipeId = `pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            state.addPipe({
              id: pipeId,
              x1: drawing.startX, y1: drawing.startY,
              x2: snapped.x, y2: snapped.y,
              diameterIn: 0.75,
              material: 'copper_liquid',
              fabricId: pipeId,
            });
          }
          state.markDirty();
        }

        if (drawing.ghostLine) canvas.remove(drawing.ghostLine);
        drawing.ghostLine = null;
        drawing.active = false;
        state.setDrawingInfo(null);
        state.setActiveTool('select');
        syncFloorToCanvas(canvas);
      }
    });

    canvas.on('mouse:up', () => {
      if (isDragging) {
        canvas.setViewportTransform(canvas.viewportTransform!);
        isDragging = false;
        canvas.selection = useCadStore.getState().activeTool === 'select';
        const active = useCadStore.getState().activeTool;
        canvas.defaultCursor = active === 'pan' ? 'grab' : active === 'draw_wall' || active === 'add_dimension' ? 'crosshair' : 'default';
      }
    });

    // ── Selection syncing ────────────────────────────────────────────────
    canvas.on('selection:created', (e) => {
      const obj = (e.selected?.[0] as any) ?? null;
      setSelectedObject(obj);
      if (obj?.name?.startsWith('wall-')) useCadStore.getState().setSelectedWallId(obj.name);
    });
    canvas.on('selection:updated', (e) => {
      const obj = (e.selected?.[0] as any) ?? null;
      setSelectedObject(obj);
      if (obj?.name?.startsWith('wall-')) useCadStore.getState().setSelectedWallId(obj.name);
    });
    canvas.on('selection:cleared', () => {
      setSelectedObject(null);
      useCadStore.getState().setSelectedWallId(null);
    });

    // ── Underlay object:modified — sync back to store ────────────────────
    canvas.on('object:modified', (e) => {
      const obj = e.target as any;
      if (!obj?.name?.startsWith(PREFIX.underlay)) return;
      const id = (obj.name as string).replace(PREFIX.underlay, '');
      const state = useCadStore.getState();
      const floor = state.floors.find(f => f.id === state.activeFloorId);
      const existing = floor?.underlays?.find(u => u.id === id);
      if (!existing) return;

      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;
      // Simpler: use the actual rendered dimensions
      const renderedW = (obj.width ?? existing.width) * scaleX;
      const renderedH = (obj.height ?? existing.height) * scaleY;

      state.updateUnderlay(id, {
        x: obj.left ?? existing.x,
        y: obj.top ?? existing.y,
        width: renderedW,
        height: renderedH,
        rotation: obj.angle ?? existing.rotation,
      });
      state.markDirty();
    });

    // ── Keyboard shortcuts ───────────────────────────────────────────────
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        cancelDrawing();
        useCadStore.getState().setActiveTool('select');
        return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useCadStore.getState().undo();
        syncFloorToCanvas(canvas);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useCadStore.getState().redo();
        syncFloorToCanvas(canvas);
        return;
      }

      // Delete selected object (wall, opening, HVAC, pipe, annotation, underlay)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useCadStore.getState();
        // Check wall first (tracked separately)
        if (state.selectedWallId) {
          state.removeWall(state.selectedWallId);
          state.setSelectedWallId(null);
          state.setSelectedObject(null);
          state.markDirty();
          syncFloorToCanvas(canvas);
          return;
        }
        // Check fabric selectedObject for other types
        const obj = state.selectedObject;
        const name = (obj as any)?.name as string | undefined;
        if (name) {
          if (name.startsWith(PREFIX.opening)) {
            const id = name.slice(PREFIX.opening.length);
            state.removeOpening(id);
          } else if (name.startsWith(PREFIX.hvac)) {
            const id = name.slice(PREFIX.hvac.length);
            state.removeHvacUnit(id);
          } else if (name.startsWith(PREFIX.pipe)) {
            const id = name.slice(PREFIX.pipe.length);
            state.removePipe(id);
          } else if (name.startsWith(PREFIX.annotation)) {
            const id = name.slice(PREFIX.annotation.length);
            state.removeAnnotation(id);
          } else if (name.startsWith(PREFIX.underlay)) {
            const id = name.slice(PREFIX.underlay.length);
            state.removeUnderlay(id);
          } else {
            return; // Unknown object type, skip
          }
          state.setSelectedObject(null);
          state.markDirty();
          canvas.discardActiveObject();
          syncFloorToCanvas(canvas);
          return;
        }
      }

      // Tool shortcuts (single keys, no modifiers)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const state = useCadStore.getState();
        const key = e.key.toLowerCase();

        // Tool selection
        if (key === 'v') state.setActiveTool('select');
        else if (key === 'h') state.setActiveTool('pan');
        else if (key === 'w') state.setActiveTool('draw_wall');
        else if (key === 'd') state.setActiveTool('add_dimension');
        else if (key === 'l') state.setActiveTool('add_label');
        else if (key === 'r') state.setActiveTool('room_detect');
        // Placement tools
        else if (key === 'o') state.setActiveTool('place_door');
        else if (key === 'i') state.setActiveTool('place_window');
        else if (key === 'u') state.setActiveTool('place_hvac');
        // Panel toggles
        else if (key === 't') state.togglePanel('toolbox');
        else if (key === 'p') state.togglePanel('properties');
        else if (key === 'f') state.togglePanel('floors');
        else if (key === 'n') state.togglePanel('navbar');
        // Grid snap toggle
        else if (key === 'g') state.setGridSnapEnabled(!state.gridSnapEnabled);
        // Focus mode — collapse all panels
        else if (key === '`') {
          const allCollapsed = !state.panelToolbox && !state.panelProperties && !state.panelFloors && !state.panelNavBar;
          if (allCollapsed) state.expandAllPanels();
          else state.collapseAllPanels();
        }
      }

      // Ctrl+S / Cmd+S — Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        // Trigger save via click on save button (reuse TopNavigationBar logic)
        const saveBtn = document.querySelector('[aria-label="Save Project"]') as HTMLButtonElement;
        if (saveBtn) saveBtn.click();
      }

      // Ctrl+E / Cmd+E — Export PDF
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        const exportBtn = document.querySelector('[aria-label="Export PDF"]') as HTMLButtonElement;
        if (exportBtn) exportBtn.click();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // ── Resize ───────────────────────────────────────────────────────────
    const handleResize = () => {
      canvas.setDimensions({ width: window.innerWidth, height: window.innerHeight });
      canvas.requestRenderAll();
    };
    window.addEventListener('resize', handleResize);

    // ── Initial sync ─────────────────────────────────────────────────────
    syncFloorToCanvas(canvas);

    // ── Store subscription for floor/layer changes ───────────────────────
    const unsub = useCadStore.subscribe((state, prevState) => {
      if (
        state.activeFloorId !== prevState.activeFloorId ||
        state.floors !== prevState.floors ||
        state.layers !== prevState.layers ||
        state.thermalOverlayEnabled !== prevState.thermalOverlayEnabled
      ) {
        syncFloorToCanvas(canvas);
      }
    });

    canvas.requestRenderAll();

    return () => {
      unsub();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync cursor + cancel drawing when tool changes ────────────────────────
  useEffect(() => {
    const cvs = fabricRef.current;
    const drawing = drawingRef.current;
    if (!cvs) return;

    if (activeTool !== 'draw_wall' && activeTool !== 'draw_pipe' && activeTool !== 'add_dimension' && drawing.active) {
      if (drawing.ghostLine) {
        cvs.remove(drawing.ghostLine);
        drawing.ghostLine = null;
      }
      drawing.active = false;
      useCadStore.getState().setDrawingInfo(null);
      cvs.requestRenderAll();
    }

    // Clean up placement ghost
    if (placementGhostRef.current) {
      cvs.remove(placementGhostRef.current);
      placementGhostRef.current = null;
    }

    if (activeTool === 'pan') {
      cvs.defaultCursor = 'grab';
      cvs.selection = false;
    } else if (activeTool === 'draw_wall' || activeTool === 'add_dimension') {
      cvs.defaultCursor = 'crosshair';
      cvs.selection = false;
    } else if (activeTool === 'place_window' || activeTool === 'place_door' || activeTool === 'place_hvac') {
      cvs.defaultCursor = 'crosshair';
      cvs.selection = false;
    } else if (activeTool === 'room_detect') {
      cvs.defaultCursor = 'pointer';
      cvs.selection = false;
    } else {
      cvs.defaultCursor = 'default';
      cvs.selection = true;
    }
  }, [activeTool]);

  return (
    <div
      className="absolute inset-0 z-0 bg-slate-900 overflow-hidden"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
