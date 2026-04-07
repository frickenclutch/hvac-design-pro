import { useEffect, useRef, useCallback } from 'react';
import * as fabric from 'fabric';
import { useCadStore } from '../store/useCadStore';
import type { WallMaterial, WallSegment, Opening, HvacUnit, Annotation } from '../store/useCadStore';

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
  annotation: 'ann-',
  room: 'room-',
  ghost: '__ghost_',
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

export default function CadCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const drawingRef = useRef<DrawingState>({ active: false, ghostLine: null, startX: 0, startY: 0 });
  const placementGhostRef = useRef<fabric.Object | null>(null);

  const { activeTool, setZoom, setPanOffset, setSelectedObject, setCanvas } = useCadStore();

  // ── Snap helper ────────────────────────────────────────────────────────────
  const snapToGrid = useCallback((worldX: number, worldY: number) => {
    const { gridSnapEnabled, projectScale } = useCadStore.getState();
    if (!gridSnapEnabled) return { x: worldX, y: worldY };
    const g = projectScale.pxPerFt;
    return { x: Math.round(worldX / g) * g, y: Math.round(worldY / g) * g };
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
    return new fabric.Line([w.x1, w.y1, w.x2, w.y2], {
      stroke: '#34d399',
      strokeWidth: 8,
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
        fill: 'rgba(56, 189, 248, 0.3)',
        stroke: '#38bdf8',
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
      name: `${PREFIX.hvac}${unit.id}`,
      hasControls: false,
      angle: unit.rotation,
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

    return new fabric.FabricText(ann.text, {
      left: ann.x,
      top: ann.y,
      fontSize: 14,
      fontFamily: 'sans-serif',
      fill: '#e2e8f0',
      angle: ann.rotation ?? 0,
      selectable: true,
      evented: true,
      name: `${PREFIX.annotation}${ann.id}`,
    });
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
             n.startsWith(PREFIX.hvac) || n.startsWith(PREFIX.annotation) ||
             n.startsWith(PREFIX.room);
    });
    toRemove.forEach(obj => canvas.remove(obj));

    const wallsLayer = state.layers.find(l => l.id === 'walls');
    const openingsLayer = state.layers.find(l => l.id === 'openings');
    const hvacLayer = state.layers.find(l => l.id === 'hvac');
    const annotationsLayer = state.layers.find(l => l.id === 'annotations');

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

    canvas.requestRenderAll();
  }, [createWallLine, createOpeningShape, createHvacShape, createAnnotationShape]);

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

      // ─ Right-click ends wall chain or cancels placement ─────────────
      if (evt.button === 2) {
        if (tool === 'draw_wall' && drawing.active) {
          // End wall chain, return to select
          if (drawing.ghostLine) canvas.remove(drawing.ghostLine);
          drawing.ghostLine = null;
          drawing.active = false;
          state.setDrawingInfo(null);
          state.setActiveTool('select');
          canvas.requestRenderAll();
        } else if (tool !== 'select' && tool !== 'pan') {
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
        // Return to select after placing
        state.setActiveTool('select');
        return;
      }

      // ─ Label placement (place one, return to select) ───────────────
      if (tool === 'add_label' && evt.button === 0) {
        const annId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const annotation: Annotation = {
          id: annId,
          type: 'label',
          x: snapped.x,
          y: snapped.y,
          text: 'Label',
          fabricId: `${PREFIX.annotation}${annId}`,
        };
        state.addAnnotation(annotation);
        state.markDirty();
        syncFloorToCanvas(canvas);
        // Return to select after placing
        state.setActiveTool('select');
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

      // Ghost line update for wall draw and dimension
      if ((tool === 'draw_wall' || tool === 'add_dimension') && drawing.active && drawing.ghostLine) {
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

    // ── Double-click ends wall chain ───────────────────────────────
    canvas.on('mouse:dblclick', (opt) => {
      const state = useCadStore.getState();
      if (state.activeTool === 'draw_wall' && drawing.active) {
        // Commit current ghost as final wall, then end chain
        const evt = opt.e as MouseEvent;
        const ptr = canvas.getScenePoint(evt);
        const snapped = snapToGrid(ptr.x, ptr.y);
        const lengthFt = computeLengthFt(drawing.startX, drawing.startY, snapped.x, snapped.y);

        if (lengthFt >= 0.1) {
          const wallId = `wall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          state.addWall({
            id: wallId,
            x1: drawing.startX, y1: drawing.startY,
            x2: snapped.x, y2: snapped.y,
            thicknessIn: 3.5, rValue: 19,
            material: 'insulated_stud' as WallMaterial,
            fabricId: wallId,
          });
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

      // Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useCadStore.getState();
        if (state.selectedWallId) {
          state.removeWall(state.selectedWallId);
          state.setSelectedWallId(null);
          state.markDirty();
          syncFloorToCanvas(canvas);
          return;
        }
      }

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') useCadStore.getState().setActiveTool('select');
        if (e.key === 'h' || e.key === 'H') useCadStore.getState().setActiveTool('pan');
        if (e.key === 'w' || e.key === 'W') useCadStore.getState().setActiveTool('draw_wall');
        if (e.key === 'd' || e.key === 'D') useCadStore.getState().setActiveTool('add_dimension');
        if (e.key === 'l' || e.key === 'L') useCadStore.getState().setActiveTool('add_label');
        if (e.key === 'r' || e.key === 'R') useCadStore.getState().setActiveTool('room_detect');
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
        state.layers !== prevState.layers
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

    if (activeTool !== 'draw_wall' && activeTool !== 'add_dimension' && drawing.active) {
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
    <div className="absolute inset-0 z-0 bg-slate-900 overflow-hidden">
      <canvas ref={canvasRef} />
    </div>
  );
}
