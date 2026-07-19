import { create } from 'zustand';
import * as fabric from 'fabric';
import { scopedKey } from '../../../utils/storage';

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
  | 'room_detect'
  | 'draw_pipe'
  | 'draw_duct'
  | 'place_fitting'
  | 'draw_radiant'
  | 'calibrate_scale';

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

// ── Piping ──────────────────────────────────────────────────────────────────────
export type PipeMaterial = 'copper_liquid' | 'copper_suction' | 'pvc_condensate' | 'gas_black_iron';

export interface PipeSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  diameterIn: number;
  material: PipeMaterial;
  fabricId: string;
}

// ── Duct Types ─────────────────────────────────────────────────────────────────
export type DuctShape = 'round' | 'rectangular' | 'oval';
export type DuctMaterial = 'sheet_metal' | 'flex_r4' | 'flex_r6' | 'flex_r8' | 'spiral' | 'fiberglass_board' | 'fabric' | 'pvc';
export type DuctSide = 'supply' | 'return';
export type DuctRole = 'trunk' | 'branch' | 'plenum' | 'takeoff' | 'runout';
export type FittingType = 'elbow_90' | 'elbow_45' | 'elbow_radius' | 'tee_branch' | 'tee_straight' | 'wye' | 'reducer' | 'transition_rect_round' | 'end_cap' | 'register_boot' | 'return_boot' | 'takeoff_round' | 'takeoff_rect' | 'damper_manual' | 'damper_motorized' | 'splitter' | 'turning_vanes';

export interface DuctSegment {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  shape: DuctShape;
  material: DuctMaterial;
  side: DuctSide;
  role: DuctRole;
  diameterIn?: number;
  widthIn?: number;
  heightIn?: number;
  cfm?: number;
  velocityFpm?: number;
  pressureDropInwg?: number;
  frictionRateInwg100?: number;
  systemId?: string;
  parentSegmentId?: string;
  roomId?: string;
  fabricId: string;
}

export interface DuctFitting {
  id: string;
  type: FittingType;
  x: number; y: number;
  rotation: number;
  shape: DuctShape;
  inletSegmentId?: string;
  outletSegmentIds?: string[];
  equivLengthFt: number;
  pressureDropInwg?: number;
  diameterIn?: number;
  widthIn?: number;
  heightIn?: number;
  fabricId: string;
}

export interface DuctSystem {
  id: string;
  name: string;
  side: DuctSide;
  equipmentId?: string;
  designCfm?: number;
  availableSpInwg?: number;
  frictionRateInwg100?: number;
  totalEquivLengthFt?: number;
}

// ── Radiant Types ──────────────────────────────────────────────────────────────
export type RadiantType = 'hydronic_floor' | 'hydronic_ceiling' | 'hydronic_wall' | 'electric_floor' | 'electric_ceiling' | 'radiant_panel';
export type RadiantFluidType = 'water' | 'glycol_20' | 'glycol_50';

export interface RadiantZone {
  id: string;
  type: RadiantType;
  x: number; y: number;
  width: number; height: number;
  rotation: number;
  roomId?: string;
  tubeSpacingIn?: number;
  tubeDiameterIn?: number;
  fluidType?: RadiantFluidType;
  supplyTempF?: number;
  returnTempF?: number;
  flowGpm?: number;
  loopLengthFt?: number;
  wattsPerSqFt?: number;
  voltage?: number;
  outputBtuPerSqFt?: number;
  floorCovering?: string;
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
  // Text styling (optional — label/note types)
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  borderColor?: string;
  scaleX?: number;
  scaleY?: number;
}

// ── Underlay Images ─────────────────────────────────────────────────────────────
export interface UnderlayImage {
  id: string;
  name: string;       // original filename
  dataUrl: string;     // base64 data URL
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
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
  pipes: PipeSegment[];
  ductSegments: DuctSegment[];
  ductFittings: DuctFitting[];
  ductSystems: DuctSystem[];
  radiantZones: RadiantZone[];
  annotations: Annotation[];
  underlays: UnderlayImage[];
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
  before: Partial<Floor>;
  after: Partial<Floor>;
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

// ── Blueprint intake dialogs (ephemeral, never serialized) ──────────────────────
// Multi-page PDF import pauses mid-rasterization until the user picks a page.
export interface PdfPageRequest {
  fileName: string;
  numPages: number;
  resolve: (page: number | null) => void;
}

// Scale calibration: two points clicked on the canvas, awaiting the real-world
// distance between them. Applying scales the underlay about p1.
export interface CalibrationRequest {
  underlayId: string;
  underlayName: string;
  distPx: number;
  p1: { x: number; y: number };
}

// AI extraction: the active floor's blueprint sheets queued for Claude-vision
// room takeoff (multi-sheet plan sets are merged into one schedule). The
// dialog owns the request → review → confirm lifecycle. underlayIds parallels
// dataUrls — extracted polygons carry an imageIndex that resolves through it
// back to the source sheet's placement rect.
export interface AiExtractRequest {
  underlayName: string;
  dataUrls: string[];
  underlayIds: string[];
}

// A drawing saved before the underlay-origin fix has been loaded. Its sheets
// are NOT rendered until the user resolves this — showing them first would
// display the blueprint half a sheet away from the geometry traced against it,
// which is exactly the confusion the fix removes.
export interface UnderlayMigrationRequest {
  sheetCount: number;
}

// Vector trace: pull the true line geometry out of a CAD-plotted PDF and
// convert it to CAD walls. Exact by construction — no vision model involved.
export interface VectorTraceRequest {
  underlayId: string;
  underlayName: string;
}

// ── Serialized drawing ────────────────────────────────────────────────────────────
// The canvas payload that serializeDrawing() emits and loadDrawing() reads —
// persisted to localStorage and synced to D1 as the drawing's canvas_json.
// loadDrawing() takes incoming data as `unknown` and defends every field, so
// older/newer snapshots still hydrate.
export interface SerializedDrawing {
  floors: Floor[];
  activeFloorId: string;
  /** Schema marker: sheets authored after the underlay-origin fix, where
   *  UnderlayImage.x/y is the sheet's top-left (as every consumer assumes).
   *  Absent on drawings saved while sheets were rendered centered on x/y —
   *  those need the one-time re-anchor prompt before they are shown. */
  underlayOrigin?: 'top-left';
  layers: Layer[];
  projectScale: ProjectScale;
  gridSnapEnabled: boolean;
  zoom: number;
  panOffset: { x: number; y: number };
  canvasBgColor: string;
  wallColor: string;
  openingColor: string;
  hvacAccentColor: string;
  panelToolbox: boolean;
  panelProperties: boolean;
  panelFloors: boolean;
  panelNavBar: boolean;
  ghostingEnabled: boolean;
}

// ── Defaults ────────────────────────────────────────────────────────────────────
const DEFAULT_LAYERS: Layer[] = [
  { id: 'walls', name: 'Walls', visible: true, locked: false, color: '#22c55e', opacity: 1 },
  { id: 'openings', name: 'Openings', visible: true, locked: false, color: '#38bdf8', opacity: 1 },
  { id: 'hvac', name: 'HVAC', visible: true, locked: false, color: '#a78bfa', opacity: 1 },
  { id: 'piping', name: 'Piping', visible: true, locked: false, color: '#ec4899', opacity: 1 },
  { id: 'ducts_supply', name: 'Ducts (Supply)', visible: true, locked: false, color: '#3b82f6', opacity: 1 },
  { id: 'ducts_return', name: 'Ducts (Return)', visible: true, locked: false, color: '#ef4444', opacity: 1 },
  { id: 'radiant', name: 'Radiant Systems', visible: true, locked: false, color: '#f97316', opacity: 1 },
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
  pipes: [],
  ductSegments: [],
  ductFittings: [],
  ductSystems: [],
  radiantZones: [],
  annotations: [],
  underlays: [],
});

// ── Helpers ─────────────────────────────────────────────────────────────────────
let floorCounter = 1;

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

  // ── Appearance / Accessibility ─────────────────────────────────────────────
  canvasBgColor: string;
  setCanvasBgColor: (color: string) => void;
  wallColor: string;
  setWallColor: (color: string) => void;
  openingColor: string;
  setOpeningColor: (color: string) => void;
  hvacAccentColor: string;
  setHvacAccentColor: (color: string) => void;

  showHelp: boolean;
  setShowHelp: (show: boolean) => void;

  // ── Thermal overlay ─────────────────────────────────────────────────────────
  thermalOverlayEnabled: boolean;
  setThermalOverlayEnabled: (enabled: boolean) => void;

  // ── Panel visibility (all collapsible) ────────────────────────────────────
  panelToolbox: boolean;
  panelProperties: boolean;
  panelFloors: boolean;
  panelNavBar: boolean;
  is3DViewOpen: boolean;
  setIs3DViewOpen: (open: boolean) => void;
  setPanelToolbox: (show: boolean) => void;
  setPanelProperties: (show: boolean) => void;
  setPanelFloors: (show: boolean) => void;
  setPanelNavBar: (show: boolean) => void;
  togglePanel: (panel: 'toolbox' | 'properties' | 'floors' | 'navbar') => void;
  collapseAllPanels: () => void;
  expandAllPanels: () => void;

  // ── Project scale ───────────────────────────────────────────────────────────
  projectScale: ProjectScale;
  setProjectScale: (scale: ProjectScale) => void;

  // ── Live drawing HUD ────────────────────────────────────────────────────────
  drawingInfo: DrawingInfo | null;
  setDrawingInfo: (info: DrawingInfo | null) => void;

  pdfPageRequest: PdfPageRequest | null;
  setPdfPageRequest: (req: PdfPageRequest | null) => void;
  calibrationRequest: CalibrationRequest | null;
  setCalibrationRequest: (req: CalibrationRequest | null) => void;
  aiExtractRequest: AiExtractRequest | null;
  setAiExtractRequest: (req: AiExtractRequest | null) => void;
  vectorTraceRequest: VectorTraceRequest | null;
  setVectorTraceRequest: (req: VectorTraceRequest | null) => void;
  underlayMigration: UnderlayMigrationRequest | null;
  /** 'reanchor' keeps each sheet exactly where it was displayed before the fix
   *  (x -= width/2); 'keep' leaves the stored coordinates untouched. */
  resolveUnderlayMigration: (mode: 'reanchor' | 'keep') => void;

  // ── Multi-floor system ──────────────────────────────────────────────────────
  floors: Floor[];
  activeFloorId: string;
  addFloor: (name?: string) => void;
  removeFloor: (id: string) => void;
  setActiveFloor: (id: string) => void;
  updateFloor: (id: string, patch: Partial<Floor>) => void;
  ghostingEnabled: boolean;
  setGhostingEnabled: (enabled: boolean) => void;

  // ── Backwards-compat wall accessors (delegate to active floor) ──────────────
  walls: WallSegment[];
  addWall: (wall: WallSegment) => void;
  updateWall: (id: string, patch: Partial<WallSegment>) => void;
  removeWall: (id: string) => void;

  selectedWallId: string | null;
  setSelectedWallId: (id: string | null) => void;

  // ── Underlays (per-floor) ────────────────────────────────────────────────────
  addUnderlay: (img: UnderlayImage) => void;
  updateUnderlay: (id: string, patch: Partial<UnderlayImage>) => void;
  removeUnderlay: (id: string) => void;

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
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;

  // ── Layers ──────────────────────────────────────────────────────────────────
  layers: Layer[];
  activeLayerId: string;
  setActiveLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  soloLayer: (id: string) => void;

  // ── Piping Actions ──────────────────────────────────────────────────────────
  pipes: PipeSegment[];
  addPipe: (pipe: PipeSegment) => void;
  updatePipe: (id: string, patch: Partial<PipeSegment>) => void;
  removePipe: (id: string) => void;

  // ── Duct Segments ──────────────────────────────────────────────────────────
  addDuctSegment: (segment: DuctSegment) => void;
  updateDuctSegment: (id: string, patch: Partial<DuctSegment>) => void;
  removeDuctSegment: (id: string) => void;

  // ── Duct Fittings ─────────────────────────────────────────────────────────
  addDuctFitting: (fitting: DuctFitting) => void;
  updateDuctFitting: (id: string, patch: Partial<DuctFitting>) => void;
  removeDuctFitting: (id: string) => void;

  // ── Duct Systems ──────────────────────────────────────────────────────────
  addDuctSystem: (system: DuctSystem) => void;
  updateDuctSystem: (id: string, patch: Partial<DuctSystem>) => void;
  removeDuctSystem: (id: string) => void;

  // ── Radiant Zones ─────────────────────────────────────────────────────────
  addRadiantZone: (zone: RadiantZone) => void;
  updateRadiantZone: (id: string, patch: Partial<RadiantZone>) => void;
  removeRadiantZone: (id: string) => void;

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

  setProjectId: (id: string | null) => void;
  setDrawingId: (id: string | null) => void;
  markDirty: () => void;
  markSaved: (drawingId: string) => void;
  setSaving: (saving: boolean) => void;
  setSaveError: (error: string | null) => void;

  // ── Version preview mode ────────────────────────────────────────────────
  // True when the user is viewing a historical version snapshot (not the
  // live drawing). The auto-save hook checks this flag and skips writes
  // so a peek doesn't accidentally restore. CadWorkspace renders a banner
  // above the canvas whenever this is true; the banner controls toggle it.
  previewMode: boolean;
  setPreviewMode: (on: boolean) => void;

  // ── Serialize / Deserialize ─────────────────────────────────────────────────
  serializeDrawing: () => SerializedDrawing;
  loadDrawing: (data: unknown) => void;
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

    // ── Thermal overlay ──────────────────────────────────────────────────────
    thermalOverlayEnabled: false,
    setThermalOverlayEnabled: (enabled) => set({ thermalOverlayEnabled: enabled }),

    // ── Canvas selection ──────────────────────────────────────────────────────
    selectedObject: null,
    setSelectedObject: (obj) => set({ selectedObject: obj }),

    gridSnapEnabled: true,
    setGridSnapEnabled: (enabled) => set({ gridSnapEnabled: enabled }),

    // ── Appearance / Accessibility ───────────────────────────────────────────
    canvasBgColor: '#0f172a',
    setCanvasBgColor: (color) => set({ canvasBgColor: color }),
    wallColor: '#34d399',
    setWallColor: (color) => set({ wallColor: color }),
    openingColor: '#38bdf8',
    setOpeningColor: (color) => set({ openingColor: color }),
    hvacAccentColor: '#22d3ee',
    setHvacAccentColor: (color) => set({ hvacAccentColor: color }),

    showHelp: false,
    setShowHelp: (show) => set({ showHelp: show }),

    panelToolbox: true,
    panelProperties: true,
    panelFloors: true,
    panelNavBar: true,
    is3DViewOpen: false,
    setIs3DViewOpen: (open) => set({ is3DViewOpen: open }),
    setPanelToolbox: (show) => set({ panelToolbox: show }),
    setPanelProperties: (show) => set({ panelProperties: show }),
    setPanelFloors: (show) => set({ panelFloors: show }),
    setPanelNavBar: (show) => set({ panelNavBar: show }),
    togglePanel: (panel) => set((s) => {
      const key = `panel${panel.charAt(0).toUpperCase() + panel.slice(1)}` as 'panelToolbox' | 'panelProperties' | 'panelFloors' | 'panelNavBar';
      return { [key]: !s[key] } as Partial<CadState>;
    }),
    collapseAllPanels: () => set({ panelToolbox: false, panelProperties: false, panelFloors: false, panelNavBar: false }),
    expandAllPanels: () => set({ panelToolbox: true, panelProperties: true, panelFloors: true, panelNavBar: true }),

    // ── Project scale ─────────────────────────────────────────────────────────
    projectScale: { pxPerFt: 40 },
    setProjectScale: (scale) => set({ projectScale: scale }),

    // ── Live drawing HUD ──────────────────────────────────────────────────────
    drawingInfo: null,
    setDrawingInfo: (info) => set({ drawingInfo: info }),

    pdfPageRequest: null,
    setPdfPageRequest: (req) => set({ pdfPageRequest: req }),
    calibrationRequest: null,
    setCalibrationRequest: (req) => set({ calibrationRequest: req }),
    aiExtractRequest: null,
    setAiExtractRequest: (req) => set({ aiExtractRequest: req }),

    vectorTraceRequest: null,
    setVectorTraceRequest: (req) => set({ vectorTraceRequest: req }),

    underlayMigration: null,
    resolveUnderlayMigration: (mode) => {
      if (mode === 'keep') {
        set({ underlayMigration: null, isDirty: true });
        return;
      }
      // Pre-fix, a sheet stored at (x, y) was drawn CENTERED there, occupying
      // [x - w/2, x + w/2]. Now it is drawn from its top-left. Subtracting half
      // its size reproduces the box the user last saw, so any walls they traced
      // against it stay aligned.
      //
      // Rotation matters: Fabric rotates about the origin point, so moving the
      // origin from centre to top-left also moves the pivot. The rendered centre
      // becomes (x, y) + R(angle)·(w/2, h/2), and the inverse that holds the
      // sheet still is therefore (x, y) − R(angle)·(w/2, h/2). At rotation 0
      // this is exactly the plain half-size subtraction above.
      set((s) => ({
        floors: s.floors.map(f => ({
          ...f,
          underlays: (f.underlays ?? []).map(u => {
            const t = ((u.rotation ?? 0) * Math.PI) / 180;
            const cos = Math.cos(t), sin = Math.sin(t);
            return {
              ...u,
              x: u.x - (u.width / 2) * cos + (u.height / 2) * sin,
              y: u.y - (u.width / 2) * sin - (u.height / 2) * cos,
            };
          }),
        })),
        underlayMigration: null,
        isDirty: true,
      }));
    },

    // ── Multi-floor system ────────────────────────────────────────────────────
    floors: [defaultFloor],
    activeFloorId: defaultFloor.id,
    ghostingEnabled: true,
    setGhostingEnabled: (enabled) => set({ ghostingEnabled: enabled }),

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
        pipes: [],
        ductSegments: [],
        ductFittings: [],
        ductSystems: [],
        radiantZones: [],
        annotations: [],
        underlays: [],
      };
      set({
        floors: [...state.floors, newFloor],
        activeFloorId: newFloor.id,
        isDirty: true,
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
          isDirty: true,
        };
      }),

    setActiveFloor: (id) => set({ activeFloorId: id }),

    updateFloor: (id, patch) =>
      set((s) => ({
        floors: s.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        isDirty: true,
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

    // ── Underlays ─────────────────────────────────────────────────────────────
    addUnderlay: (img) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          underlays: [...(f.underlays ?? []), img],
        })),
      })),

    updateUnderlay: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          underlays: (f.underlays ?? []).map((u) =>
            u.id === id ? { ...u, ...patch } : u,
          ),
        })),
      })),

    removeUnderlay: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          underlays: (f.underlays ?? []).filter((u) => u.id !== id),
        })),
      })),

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

    updateAnnotation: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          annotations: f.annotations.map((a) =>
            a.id === id ? { ...a, ...patch } : a,
          ),
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
    activeLayerId: 'walls',

    setActiveLayer: (id) => set({ activeLayerId: id }),

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

    setLayerOpacity: (id, opacity) =>
      set((s) => ({
        layers: s.layers.map((l) =>
          l.id === id ? { ...l, opacity } : l,
        ),
      })),

    soloLayer: (id) =>
      set((s) => ({
        layers: s.layers.map((l) => ({
          ...l,
          visible: l.id === id,
        })),
      })),

    // ── Piping ────────────────────────────────────────────────────────────────
    get pipes() {
      const state = get();
      const floor = state.floors.find((f) => f.id === state.activeFloorId);
      return floor?.pipes ?? [];
    },

    addPipe: (pipe) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          pipes: [...(f.pipes ?? []), pipe],
        })),
      })),

    updatePipe: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          pipes: (f.pipes ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      })),

    removePipe: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          pipes: (f.pipes ?? []).filter((p) => p.id !== id),
        })),
      })),

    // ── Duct Segments ────────────────────────────────────────────────────────
    addDuctSegment: (segment) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductSegments: [...(f.ductSegments ?? []), segment],
        })),
        isDirty: true,
      })),

    updateDuctSegment: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductSegments: (f.ductSegments ?? []).map((d) =>
            d.id === id ? { ...d, ...patch } : d,
          ),
        })),
        isDirty: true,
      })),

    removeDuctSegment: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductSegments: (f.ductSegments ?? []).filter((d) => d.id !== id),
        })),
        isDirty: true,
      })),

    // ── Duct Fittings ────────────────────────────────────────────────────────
    addDuctFitting: (fitting) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductFittings: [...(f.ductFittings ?? []), fitting],
        })),
        isDirty: true,
      })),

    updateDuctFitting: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductFittings: (f.ductFittings ?? []).map((d) =>
            d.id === id ? { ...d, ...patch } : d,
          ),
        })),
        isDirty: true,
      })),

    removeDuctFitting: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductFittings: (f.ductFittings ?? []).filter((d) => d.id !== id),
        })),
        isDirty: true,
      })),

    // ── Duct Systems ─────────────────────────────────────────────────────────
    addDuctSystem: (system) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductSystems: [...(f.ductSystems ?? []), system],
        })),
        isDirty: true,
      })),

    updateDuctSystem: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductSystems: (f.ductSystems ?? []).map((d) =>
            d.id === id ? { ...d, ...patch } : d,
          ),
        })),
        isDirty: true,
      })),

    removeDuctSystem: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          ductSystems: (f.ductSystems ?? []).filter((d) => d.id !== id),
        })),
        isDirty: true,
      })),

    // ── Radiant Zones ────────────────────────────────────────────────────────
    addRadiantZone: (zone) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          radiantZones: [...(f.radiantZones ?? []), zone],
        })),
        isDirty: true,
      })),

    updateRadiantZone: (id, patch) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          radiantZones: (f.radiantZones ?? []).map((r) =>
            r.id === id ? { ...r, ...patch } : r,
          ),
        })),
        isDirty: true,
      })),

    removeRadiantZone: (id) =>
      set((s) => ({
        ...updateActiveFloor(s, (f) => ({
          ...f,
          radiantZones: (f.radiantZones ?? []).filter((r) => r.id !== id),
        })),
        isDirty: true,
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

    previewMode: false,
    setPreviewMode: (on) => set({ previewMode: on }),

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
        canvasBgColor: s.canvasBgColor,
        wallColor: s.wallColor,
        openingColor: s.openingColor,
        hvacAccentColor: s.hvacAccentColor,
        // Workspace UI state (persists between sessions)
        panelToolbox: s.panelToolbox,
        panelProperties: s.panelProperties,
        panelFloors: s.panelFloors,
        panelNavBar: s.panelNavBar,
        ghostingEnabled: s.ghostingEnabled,
        underlayOrigin: 'top-left',
      };
    },

    loadDrawing: (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      // Trust boundary: `data` is deserialized JSON (localStorage or the D1
      // canvas payload). We've confirmed it's an object; read it through the
      // serialized shape and defend every field for backwards/forwards compat.
      const d = data as Partial<SerializedDrawing>;
      // Ensure all floors have EVERY geometry array (backwards/forwards compat
      // + corruption defense). CadCanvas and the 3D viewer iterate these
      // directly (e.g. `for (const u of floor.hvacUnits)`), so a legacy or
      // partial snapshot missing any one of them threw "X is not iterable" and
      // took down the canvas via its ErrorBoundary. Backfill the complete set —
      // the original arrays (walls/openings/rooms/hvacUnits/pipes/annotations)
      // were previously omitted here, which is what crashed on older drafts.
      const floors: Floor[] = (d.floors ?? [createDefaultFloor()]).map((f) => ({
        ...f,
        walls: f.walls ?? [],
        openings: f.openings ?? [],
        rooms: f.rooms ?? [],
        hvacUnits: f.hvacUnits ?? [],
        pipes: f.pipes ?? [],
        annotations: f.annotations ?? [],
        underlays: f.underlays ?? [],
        ductSegments: f.ductSegments ?? [],
        ductFittings: f.ductFittings ?? [],
        ductSystems: f.ductSystems ?? [],
        radiantZones: f.radiantZones ?? [],
      }));

      const legacySheetCount = d.underlayOrigin === 'top-left'
        ? 0
        : floors.reduce((n, f) => n + (f.underlays?.length ?? 0), 0);

      // Sync floorCounter to highest existing floor index so addFloor()
      // never creates a duplicate ID that collides with a loaded floor.
      for (const f of floors) {
        const match = f.id?.match(/^floor-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= floorCounter) floorCounter = num + 1;
        }
      }

      set({
        floors,
        activeFloorId: d.activeFloorId ?? d.floors?.[0]?.id ?? 'floor-1',
        layers: d.layers ?? [...DEFAULT_LAYERS],
        projectScale: d.projectScale ?? { pxPerFt: 40 },
        gridSnapEnabled: d.gridSnapEnabled ?? true,
        zoom: d.zoom ?? 1,
        panOffset: d.panOffset ?? { x: 0, y: 0 },
        canvasBgColor: d.canvasBgColor ?? '#0f172a',
        wallColor: d.wallColor ?? '#34d399',
        openingColor: d.openingColor ?? '#38bdf8',
        hvacAccentColor: d.hvacAccentColor ?? '#22d3ee',
        // Restore workspace UI state
        panelToolbox: d.panelToolbox ?? true,
        panelProperties: d.panelProperties ?? true,
        panelFloors: d.panelFloors ?? true,
        panelNavBar: d.panelNavBar ?? true,
        ghostingEnabled: d.ghostingEnabled ?? true,
        isDirty: false,
        undoStack: [],
        redoStack: [],
        // Drawings saved before the origin fix carry no marker. If any sheets
        // are present, hold them back and ask first — see UnderlayMigrationRequest.
        underlayMigration: legacySheetCount > 0 ? { sheetCount: legacySheetCount } : null,
      });
    },
  };
});

// ── LocalStorage Persistence ─────────────────────────────────────────────────
const CAD_STORAGE_KEY_BASE = 'hvac_cad_drawing';

// Load persisted drawing + workspace state on startup
try {
  const saved = localStorage.getItem(scopedKey(CAD_STORAGE_KEY_BASE));
  if (saved) {
    const data = JSON.parse(saved) as Partial<SerializedDrawing>;
    const hasGeometry = data.floors?.some(
      (f) => f.walls?.length > 0 || f.rooms?.length > 0 || f.openings?.length > 0 || (f.underlays?.length ?? 0) > 0
    );
    // Restore geometry if present, or at least restore workspace UI state
    const hasWorkspaceState = data.panelToolbox !== undefined || data.zoom !== undefined;
    if (hasGeometry || hasWorkspaceState) {
      useCadStore.getState().loadDrawing(data);
    }
  }
} catch { /* corrupt or missing — start fresh */ }

// Auto-save when floors or workspace UI state changes (debounced)
let _cadSaveTimer: ReturnType<typeof setTimeout> | null = null;
useCadStore.subscribe((state, prevState) => {
  if (
    state.floors !== prevState.floors ||
    state.panelToolbox !== prevState.panelToolbox ||
    state.panelProperties !== prevState.panelProperties ||
    state.panelFloors !== prevState.panelFloors ||
    state.panelNavBar !== prevState.panelNavBar ||
    state.ghostingEnabled !== prevState.ghostingEnabled ||
    state.zoom !== prevState.zoom
  ) {
    if (_cadSaveTimer) clearTimeout(_cadSaveTimer);
    _cadSaveTimer = setTimeout(() => {
      try {
        const drawing = useCadStore.getState().serializeDrawing();
        localStorage.setItem(scopedKey(CAD_STORAGE_KEY_BASE), JSON.stringify(drawing));
      } catch { /* storage full */ }
    }, 500);
  }
});
