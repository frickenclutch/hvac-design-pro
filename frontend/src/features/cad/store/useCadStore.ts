import { create } from 'zustand';
import * as fabric from 'fabric';

// ── Tool Types ──────────────────────────────────────────────────────────────────
export type ToolType =
  | 'select'
  | 'pan'
  | 'draw_wall'
  | 'place_window'
  | 'place_door'
  | 'place_hvac'
  | 'add_dimension'
  | 'add_label'
  | 'room_detect';

// ── Wall ────────────────────────────────────────────────────────────────────────
export type WallMaterial = 'insulated_stud' | 'cmu' | 'concrete';

export interface WallSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thicknessIn: number;
  rValue: number;
  material: WallMaterial;
  fabricId: string;
}

// ── Openings (windows & doors) ──────────────────────────────────────────────────
export interface Opening {
  id: string;
  type: 'window' | 'door' | 'sliding_door';
  wallId: string;
  positionAlongWall: number; // 0-1 fraction along wall length
  widthIn: number;
  heightIn: number;
  // Window properties
  uFactor?: number;
  shgc?: number;
  glassType?: string;
  // Door properties
  swingDirection?: 'left' | 'right' | 'double';
  fabricId: string;
}

// ── HVAC Units ──────────────────────────────────────────────────────────────────
export interface HvacUnit {
  id: string;
  type:
    | 'supply_register'
    | 'return_grille'
    | 'air_handler'
    | 'condenser'
    | 'thermostat'
    | 'duct_run';
  x: number;
  y: number;
  rotation: number;
  cfm?: number;
  label?: string;
  fabricId: string;
}

// ── Room Detection ──────────────────────────────────────────────────────────────
export interface DetectedRoom {
  id: string;
  name: string;
  wallIds: string[];
  areaSqFt: number;
  perimeterFt: number;
  centroid: { x: number; y: number };
  color: string;
}

// ── Annotations ─────────────────────────────────────────────────────────────────
export interface Annotation {
  id: string;
  type: 'dimension' | 'label' | 'note' | 'leader';
  x: number;
  y: number;
  text: string;
  rotation?: number;
  fabricId: string;
}

// ── Floor ───────────────────────────────────────────────────────────────────────
export interface Floor {
  id: string;
  name: string;
  index: number;
  heightFt: number;
  isVisible: boolean;
  isLocked: boolean;
  walls: WallSegment[];
  openings: Opening[];
  rooms: DetectedRoom[];
  hvacUnits: HvacUnit[];
  annotations: Annotation[];
}

// ── Layer ───────────────────────────────────────────────────────────────────────
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
  opacity: number;
}

// ── Undo / Redo ─────────────────────────────────────────────────────────────────
export interface HistoryEntry {
  type: string;
  floorId: string;
  before: any;
  after: any;
  timestamp: number;
}

// ── Scale / Drawing HUD ─────────────────────────────────────────────────────────
export interface ProjectScale {
  pxPerFt: number;
}

export interface DrawingInfo {
  isDrawing: boolean;
  lengthFt: number;
  screenX: number;
  screenY: number;
}

// ── Defaults ────────────────────────────────────────────────────────────────────
const DEFAULT_LAYERS: Layer[] = [
  { id: 'walls', name: 'Walls', visible: true, locked: false, color: '#22c55e', opacity: 1 },
  { id: 'openings', name: 'Openings', visible: true, locked: false, color: '#38bdf8', opacity: 1 },
  { id: 'hvac', name: 'HVAC', visible: true, locked: false, color: '#a78bfa', opacity: 1 },
  { id: 'annotations', name: 'Annotations', visible: true, locked: false, color: '#f59e0b', opacity: 1 },
  { id: 'underlay', name: 'Underlay', visible: true, locked: true, color: '#64748b', opacity: 0.3 },
];

const createDefaultFloor = (): Floor => ({
  id: 'floor-1',
  name: 'Floor 1',
  index: 0,
  heightFt: 9,
  isVisible: true,
  isLocked: false,
  walls: [],
  openings: [],
  rooms: [],
  hvacUnits: [],
  annotations: [],
});

// ── Helpers ─────────────────────────────────────────────────────────────────────
let floorCounter = 1;

const getActiveFloor = (state: CadState): Floor => {
  return (
    state.floors.find((f) => f.id === state.activeFloorId) ?? state.floors[0]
  );
};

const updateActiveFloor = (
  state: CadState,
  updater: (floor: Floor) => Floor,
): Partial<CadState> => {
  return {
    floors: state.floors.map((f) =>
      f.id === state.activeFloorId ? updater(f) : f,
    ),
  };
};

// ── State Interface ─────────────────────────────────────────────────────────────
interface CadState {
  // ── Tool ────────────────────────────────────────────────────────────────────
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;

  // ── Viewport ────────────────────────────────────────────────────────────────
  zoom: number;
  setZoom: (zoom: number) => void;

  panOffset: { x: number; y: number };
  setPanOffset: (offset: { x: number; y: number }) => void;

  // ── Canvas instance ─────────────────────────────────────────────────────────
  canvas: fabric.Canvas | null;
  setCanvas: (canvas: fabric.Canvas | null) => void;

  // ── Canvas selection ────────────────────────────────────────────────────────
  selectedObject: fabric.Object | null;
  setSelectedObject: (obj: fabric.Object | null) => void;

  gridSnapEnabled: boolean;
  setGridSnapEnabled: (enabled: boolean) => void;

  // ── Project scale ───────────────────────────────────────────────────────────
  projectScale: ProjectScale;
  setProjectScale: (scale: ProjectScale) => void;

  // ── Live drawing HUD ────────────────────────────────────────────────────────
  drawingInfo: DrawingInfo | null;
  setDrawingInfo: (info: DrawingInfo | null) => void;

  // ── Multi-floor system ──────────────────────────────────────────────────────
  floors: Floor[];
  activeFloorId: string;
  addFloor: (name?: string) => void;
  removeFloor: (id: string) => void;
  setActiveFloor: (id: string) => void;
  updateFloor: (id: string, patch: Partial<Floor>) => void;

  // ── Backwards-compat wall accessors (delegate to active floor) ──────────────
  walls: WallSegment[];
  addWall: (wall: WallSegment) => void;
  updateWall: (id: string, patch: Partial<WallSegment>) => void;
  removeWall: (id: string) => void;

  selectedWallId: string | null;
  setSelectedWallId: (id: string | null) => void;

  // ── Underlay (kept at root for backwards compat) ────────────────────────────
  underlay?: string | null;

  // ── Openings ────────────────────────────────────────────────────────────────
  addOpening: (opening: Opening) => void;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  removeOpening: (id: string) => void;

  // ── HVAC ────────────────────────────────────────────────────────────────────
  addHvacUnit: (unit: HvacUnit) => void;
  updateHvacUnit: (id: string, patch: Partial<HvacUnit>) => void;
  removeHvacUnit: (id: string) => void;

  // ── Rooms ───────────────────────────────────────────────────────────────────
  setDetectedRooms: (rooms: DetectedRoom[]) => void;

  // ── Annotations ─────────────────────────────────────────────────────────────
  addAnnotation: (ann: Annotation) => void;
  removeAnnotation: (id: string) => void;

  // ── Layers ──────────────────────────────────────────────────────────────────
  layers: Layer[];
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;

  // ── Undo / Redo ─────────────────────────────────────────────────────────────
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  undo: () => void;
  redo: () => void;
  pushHistory: (entry: HistoryEntry) => void;

  // ── D1 Persistence ──────────────────────────────────────────────────────────
  drawingId: string | null;
  projectId: string | null;
  lastSavedAt: string | null;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;

  setProjectId: (id: string) => void;
  setDrawingId: (id: string) => void;
  markDirty: () => void;
  markSaved: (drawingId: string) => void;
  setSaving: (saving: boolean) => void;
  setSaveError: (error: string | null) => void;

  // ── Serialize / Deserialize ─────────────────────────────────────────────────
  serializeDrawing: () => object;
  loadDrawing: (data: any) => void;
}

// ── Store ───────────────────────────────────────────────────────────────────────
export const useCadStore = create<CadState>((set, get) => {
  const defaultFloor = createDefaultFloor();

  return {
    // ── Tool ──────────────────────────────────────────────────────────────────
    activeTool: 'select',
    setActiveTool: (tool) => set({ activeTool: tool }),

    // ── Viewport ──────────────────────────────────────────────────────────────
    zoom: 1,
    setZoom: (zoom) => set({ zoom }),

    panOffset: { x: 0, y: 0 },
    setPanOffset: (offset) => set({ panOffset: offset }),

    // ── Canvas instance ───────────────────────────────────────────────────────
    canvas: null,
    setCanvas: (canvas) => set({ canvas }),

    // ── Canvas selection ──────────────────────────────────────────────────────
    selectedObject: null,
    setSelectedObject: (obj) => set({ selectedObject: obj }),

    gridSnapEnabled: true,
    setGridSnapEnabled: (enabled) => set({ gridSnapEnabled: enabled }),

    // ── Project scale ─────────────────────────────────────────────────────────
    projectScale: { pxPerFt: 40 },
    setProjectScale: (scale) => set({ projectScale: scale }),

    // ── Live drawing HUD ──────────────────────────────────────────────────────
    drawingInfo: null,
    setDrawingInfo: (info) => set({ drawingInfo: info }),

    // ── Multi-floor system ────────────────────────────────────────────────────
    floors: [defaultFloor],
    activeFloorId: defaultFloor.id,

    addFloor: (name?) => {
      floorCounter += 1;
      const state = get();
      const newIndex = state.floors.length;
      const newFloor: Floor = {
        id: `floor-${floorCounter}`,
        name: name ?? `Floor ${floorCounter}`,
        index: newIndex,
        heightFt: 9,
        isVisible: true,
        isLocked: false,
        walls: [],
        openings: [],
        rooms: [],
        hvacUnits: [],
        annotations: [],
      };
      set({
        floors: [...state.floors, newFloor],
        activeFloorId: newFloor.id,
      });
    },

    removeFloor: (id) =>
      set((s) => {
        if (s.floors.length <= 1) return s; // always keep at least one floor
        const filtered = s.floors.filter((f) => f.id !== id);
        const activeStillExists = filtered.some(
          (f) => f.id === s.activeFloorId,
        );
        return {
          floors: filtered,
          activeFloorId: activeStillExists
            ? s.activeFloorId
            : filtered[0].id,
        };
      }),

    setActiveFloor: (id) => set({ activeFloorId: id }),

    updateFloor: (id, patch) =>
      set((s) => ({
        floors: s.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      })),

    // ── Backwards-compat wall accessors ───────────────────────────────────────
    // `walls` is kept as a root-level getter that delegates to the active floor.
    // Because Zustand is a flat store we maintain a mirrored `walls` array that
    // is kept in sync whenever floors change.
    get walls() {
      const state = get();
      const floor = state.floors.find((f) => f.id === state.activeFloorId);
      return floor?.walls ?? [];
    },

    addWall: (wall) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          walls: [...f.walls, wall],
        })),
      })),

    updateWall: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          walls: f.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
        })),
      })),

    removeWall: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          walls: f.walls.filter((w) => w.id !== id),
        })),
      })),

    selectedWallId: null,
    setSelectedWallId: (id) => set({ selectedWallId: id }),

    // ── Underlay ──────────────────────────────────────────────────────────────
    underlay: null,

    // ── Openings ──────────────────────────────────────────────────────────────
    addOpening: (opening) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          openings: [...f.openings, opening],
        })),
      })),

    updateOpening: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          openings: f.openings.map((o) =>
            o.id === id ? { ...o, ...patch } : o,
          ),
        })),
      })),

    removeOpening: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          openings: f.openings.filter((o) => o.id !== id),
        })),
      })),

    // ── HVAC ──────────────────────────────────────────────────────────────────
    addHvacUnit: (unit) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          hvacUnits: [...f.hvacUnits, unit],
        })),
      })),

    updateHvacUnit: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          hvacUnits: f.hvacUnits.map((u) =>
            u.id === id ? { ...u, ...patch } : u,
          ),
        })),
      })),

    removeHvacUnit: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          hvacUnits: f.hvacUnits.filter((u) => u.id !== id),
        })),
      })),

    // ── Rooms ─────────────────────────────────────────────────────────────────
    setDetectedRooms: (rooms) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({ ...f, rooms })),
      })),

    // ── Annotations ───────────────────────────────────────────────────────────
    addAnnotation: (ann) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          annotations: [...f.annotations, ann],
        })),
      })),

    removeAnnotation: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          annotations: f.annotations.filter((a) => a.id !== id),
        })),
      })),

    // ── Layers ────────────────────────────────────────────────────────────────
    layers: [...DEFAULT_LAYERS],

    toggleLayerVisibility: (id) =>
      set((s) => ({
        layers: s.layers.map((l) =>
          l.id === id ? { ...l, visible: !l.visible } : l,
        ),
      })),

    toggleLayerLock: (id) =>
      set((s) => ({
        layers: s.layers.map((l) =>
          l.id === id ? { ...l, locked: !l.locked } : l,
        ),
      })),

    // ── Undo / Redo ───────────────────────────────────────────────────────────
    undoStack: [],
    redoStack: [],

    pushHistory: (entry) =>
      set((s) => ({
        undoStack: [...s.undoStack, entry],
        redoStack: [],
        isDirty: true,
      })),

    undo: () =>
      set((s) => {
        if (s.undoStack.length === 0) return s;
        const entry = s.undoStack[s.undoStack.length - 1];
        const newUndo = s.undoStack.slice(0, -1);

        // Apply the "before" snapshot to the target floor
        const floors = s.floors.map((f) => {
          if (f.id !== entry.floorId) return f;
          return { ...f, ...entry.before };
        });

        return {
          undoStack: newUndo,
          redoStack: [...s.redoStack, entry],
          floors,
          isDirty: true,
        };
      }),

    redo: () =>
      set((s) => {
        if (s.redoStack.length === 0) return s;
        const entry = s.redoStack[s.redoStack.length - 1];
        const newRedo = s.redoStack.slice(0, -1);

        // Apply the "after" snapshot to the target floor
        const floors = s.floors.map((f) => {
          if (f.id !== entry.floorId) return f;
          return { ...f, ...entry.after };
        });

        return {
          redoStack: newRedo,
          undoStack: [...s.undoStack, entry],
          floors,
          isDirty: true,
        };
      }),

    // ── D1 Persistence ────────────────────────────────────────────────────────
    drawingId: null,
    projectId: null,
    lastSavedAt: null,
    isDirty: false,
    isSaving: false,
    saveError: null,

    setProjectId: (id) => set({ projectId: id }),
    setDrawingId: (id) => set({ drawingId: id }),
    markDirty: () => set({ isDirty: true }),
    markSaved: (drawingId) =>
      set({
        drawingId,
        isDirty: false,
        isSaving: false,
        saveError: null,
        lastSavedAt: new Date().toISOString(),
      }),
    setSaving: (saving) => set({ isSaving: saving }),
    setSaveError: (error) => set({ saveError: error, isSaving: false }),

    // ── Serialize / Deserialize ───────────────────────────────────────────────
    serializeDrawing: () => {
      const s = get();
      return {
        floors: s.floors,
        activeFloorId: s.activeFloorId,
        layers: s.layers,
        projectScale: s.projectScale,
        gridSnapEnabled: s.gridSnapEnabled,
        zoom: s.zoom,
        panOffset: s.panOffset,
      };
    },

    loadDrawing: (data: any) => {
      if (!data) return;
      set({
        floors: data.floors ?? [createDefaultFloor()],
        activeFloorId: data.activeFloorId ?? data.floors?.[0]?.id ?? 'floor-1',
        layers: data.layers ?? [...DEFAULT_LAYERS],
        projectScale: data.projectScale ?? { pxPerFt: 40 },
        gridSnapEnabled: data.gridSnapEnabled ?? true,
        zoom: data.zoom ?? 1,
        panOffset: data.panOffset ?? { x: 0, y: 0 },
        isDirty: false,
        undoStack: [],
        redoStack: [],
      });
    },
  };
});
