import { create } from 'zustand';
import * as fabric from 'fabric';

export type ToolType = 'select' | 'pan' | 'draw_wall' | 'place_window' | 'place_door' | 'place_hvac';

export type WallMaterial = 'insulated_stud' | 'cmu' | 'concrete';

export interface WallSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thicknessIn: number;  // wall thickness in inches
  rValue: number;       // thermal resistance
  material: WallMaterial;
  fabricId: string;     // matches fabric.Line .name property for lookup
}

/**
 * projectScale is exposed in Zustand so the future Spotlight Search /
 * Settings panel can surface "px per foot" to every user role —
 * regular users, admins, and super-users alike.
 */
export interface ProjectScale {
  pxPerFt: number;  // default: 40px = 1 ft  (matches the dot-grid spacing)
}

export interface DrawingInfo {
  isDrawing: boolean;
  lengthFt: number;
  screenX: number;
  screenY: number;
}

interface CadState {
  // ── Tool ──────────────────────────────────────────────────────────────────
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;

  // ── Viewport ──────────────────────────────────────────────────────────────
  zoom: number;
  setZoom: (zoom: number) => void;

  panOffset: { x: number; y: number };
  setPanOffset: (offset: { x: number; y: number }) => void;

  // ── Canvas selection ──────────────────────────────────────────────────────
  selectedObject: fabric.Object | null;
  setSelectedObject: (obj: fabric.Object | null) => void;

  gridSnapEnabled: boolean;
  setGridSnapEnabled: (enabled: boolean) => void;

  // ── Wall system ───────────────────────────────────────────────────────────
  walls: WallSegment[];
  addWall: (wall: WallSegment) => void;
  updateWall: (id: string, patch: Partial<WallSegment>) => void;
  removeWall: (id: string) => void;

  selectedWallId: string | null;
  setSelectedWallId: (id: string | null) => void;

  // ── Project scale (ready for Spotlight Search / Settings surface) ─────────
  projectScale: ProjectScale;
  setProjectScale: (scale: ProjectScale) => void;

  // ── Live drawing HUD ──────────────────────────────────────────────────────
  drawingInfo: DrawingInfo | null;
  setDrawingInfo: (info: DrawingInfo | null) => void;
}

export const useCadStore = create<CadState>((set) => ({
  // Tool
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),

  // Viewport
  zoom: 1,
  setZoom: (zoom) => set({ zoom }),

  panOffset: { x: 0, y: 0 },
  setPanOffset: (offset) => set({ panOffset: offset }),

  // Canvas selection
  selectedObject: null,
  setSelectedObject: (obj) => set({ selectedObject: obj }),

  gridSnapEnabled: true,
  setGridSnapEnabled: (enabled) => set({ gridSnapEnabled: enabled }),

  // Wall system
  walls: [],
  addWall: (wall) => set((s) => ({ walls: [...s.walls, wall] })),
  updateWall: (id, patch) =>
    set((s) => ({
      walls: s.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    })),
  removeWall: (id) => set((s) => ({ walls: s.walls.filter((w) => w.id !== id) })),

  selectedWallId: null,
  setSelectedWallId: (id) => set({ selectedWallId: id }),

  // Project scale
  projectScale: { pxPerFt: 40 },
  setProjectScale: (scale) => set({ projectScale: scale }),

  // Live drawing HUD
  drawingInfo: null,
  setDrawingInfo: (info) => set({ drawingInfo: info }),
}));
