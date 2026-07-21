import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { MousePointer2, Hand, SquarePen, LayoutGrid, DoorOpen, Wind, Ruler, Type, ScanLine, ImagePlus, Crosshair, Package, Thermometer, ChevronLeft, ChevronRight, Cylinder, GitBranch, Diamond, Minus, Plus, GripVertical, ArrowUpDown, Check, RotateCcw } from 'lucide-react';
import aiExtractIcon from '../../../assets/brand/ai-extract-icon.webp';
import { useCadStore } from '../store/useCadStore';
import type { ToolType } from '../store/useCadStore';
import { importUnderlayFiles } from '../utils/underlayImport';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
import { useGuidanceStore, glimmerClass } from '../../../stores/useGuidanceStore';
import { toast } from '../../../stores/useToastStore';
import AssetLibrary from './AssetLibrary';
import BuildingScience from './BuildingScience';

/** Minimum px from any viewport edge when dragging */
const EDGE_MARGIN = 8;

export default function Toolbox() {
  const { activeTool, setActiveTool, panelToolbox, setPanelToolbox, thermalOverlayEnabled, setThermalOverlayEnabled, is3DViewOpen } = useCadStore();
  const toolboxScale = usePreferencesStore(s => s.panelSizes.toolboxScale ?? 1);
  const savedPos = usePreferencesStore(s => s.panelSizes.toolboxPos ?? { x: 24, y: -1 });
  const updatePrefs = usePreferencesStore(s => s.update);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [showBuildingScience, setShowBuildingScience] = useState(false);

  // ── Position state ──────────────────────────────────────────────────────
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: savedPos?.x ?? 24, y: savedPos?.y ?? -1 });
  const [autoCentered, setAutoCentered] = useState(false);
  // Latest position — read by the drag-end and re-clamp handlers so prefs
  // persistence happens as a plain event-handler call, never inside a
  // setState updater (React forbids updating another component's store
  // mid-render). Kept in sync at every setPos site.
  const posRef = useRef(pos);

  // ── Arrange mode — user-ordered tool rail, persisted per user ───────────
  // Toggled from the top strip; tools stop activating and become draggable
  // rows. The order lives in prefs.toolboxOrder (null = default grouping);
  // removed tools live in prefs.toolboxHidden and surface in arrange mode's
  // hidden tray (the greater toolbox), restorable with one click.
  const toolboxOrder = usePreferencesStore(s => s.toolboxOrder);
  const toolboxHidden = usePreferencesStore(s => s.toolboxHidden ?? []);
  const [arrangeMode, setArrangeMode] = useState(false);
  const [dragToolId, setDragToolId] = useState<string | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const liveOrderRef = useRef<string[] | null>(null);
  const arrangeItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const arrangeDragInfo = useRef<{ id: string; startY: number; startIndex: number; rowH: number; order: string[] } | null>(null);

  // Auto-center vertically on first mount (y=-1 sentinel) or clamp to viewport
  useEffect(() => {
    if (!panelRef.current) return;
    const h = panelRef.current.getBoundingClientRect().height;
    const w = panelRef.current.getBoundingClientRect().width;

    if (pos.y === -1 && !autoCentered) {
      // First mount — center vertically
      const vy = Math.max(EDGE_MARGIN, (window.innerHeight - h) / 2);
      const centered = { x: pos.x, y: vy };
      posRef.current = centered;
      setPos(centered);
      setAutoCentered(true);
    } else if (!autoCentered) {
      // Saved position — clamp to current viewport so toolbox is always visible
      const maxX = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
      const maxY = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
      const clampedX = Math.max(EDGE_MARGIN, Math.min(maxX, pos.x));
      const clampedY = Math.max(EDGE_MARGIN, Math.min(maxY, pos.y));
      if (clampedX !== pos.x || clampedY !== pos.y) {
        const clamped = { x: clampedX, y: clampedY };
        posRef.current = clamped;
        setPos(clamped);
      }
      setAutoCentered(true);
    }
  }, [pos.x, pos.y, autoCentered]);

  // ── Drag handling ───────────────────────────────────────────────────────
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });

  const onDragStart = useCallback((e: React.PointerEvent) => {
    // Don't initiate drag from interactive children (buttons, inputs)
    const tag = (e.target as HTMLElement).closest('button, input, a');
    if (tag) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y };
    posRef.current = { x: pos.x, y: pos.y };

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (me: PointerEvent) => {
      if (!dragging.current) return;
      const dx = me.clientX - dragStart.current.mx;
      const dy = me.clientY - dragStart.current.my;

      // Clamp to viewport
      const el = panelRef.current;
      const w = el ? el.getBoundingClientRect().width : 60;
      const h = el ? el.getBoundingClientRect().height : 400;
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
      // Persist final position — plain call, never inside a setState updater
      const ps = usePreferencesStore.getState().panelSizes;
      const p = posRef.current;
      updatePrefs({ panelSizes: { ...ps, toolboxPos: { x: p.x, y: p.y } } });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pos.x, pos.y, updatePrefs]);

  // ── Scale controls ──────────────────────────────────────────────────────
  const adjustScale = (delta: number) => {
    const ps = usePreferencesStore.getState().panelSizes;
    const currentScale = ps.toolboxScale ?? 1;

    // Cap max scale so the toolbox can't grow taller than the viewport
    const el = panelRef.current;
    const unscaledHeight = el ? el.getBoundingClientRect().height / currentScale : 600;
    const maxScaleForViewport = Math.floor(((window.innerHeight - EDGE_MARGIN * 2) / unscaledHeight) * 100) / 100;
    const maxScale = Math.min(1.25, maxScaleForViewport);

    const next = Math.round(Math.min(maxScale, Math.max(0.7, currentScale + delta)) * 100) / 100;
    updatePrefs({ panelSizes: { ...ps, toolboxScale: next } });

    // Re-clamp position so the toolbox stays within viewport after scaling.
    // Reads posRef and persists as plain calls — no setState-updater side
    // effects (same fix as FloorSelector).
    requestAnimationFrame(() => {
      if (!panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - EDGE_MARGIN;
      const maxY = window.innerHeight - rect.height - EDGE_MARGIN;
      const p = posRef.current;
      const nx = Math.max(EDGE_MARGIN, Math.min(maxX, p.x));
      const ny = Math.max(EDGE_MARGIN, Math.min(maxY, p.y));
      if (nx !== p.x || ny !== p.y) {
        const latest = usePreferencesStore.getState().panelSizes;
        updatePrefs({ panelSizes: { ...latest, toolboxPos: { x: nx, y: ny } } });
        const next = { x: nx, y: ny };
        posRef.current = next;
        setPos(next);
      }
    });
  };

  // ── Viewport auto-fit ─────────────────────────────────────────────────────
  // The rail can be taller than a short viewport (laptop, 800px-high window),
  // which leaves the bottom tools unreachable (fixed position — no scroll).
  // Compute a fit scale from the transform-independent offsetHeight and never
  // render larger than fits. Non-destructive: the user's saved scale pref is
  // untouched and wins again on a taller viewport.
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    const compute = () => {
      const el = panelRef.current;
      if (!el || !el.offsetHeight) return;
      const avail = window.innerHeight - EDGE_MARGIN * 2;
      setFitScale(Math.min(1.25, avail / el.offsetHeight));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [panelToolbox, is3DViewOpen]);
  const effectiveScale = Math.min(toolboxScale, Math.max(0.7, fitScale));

  // ── Guidance glimmer ──────────────────────────────────────────────────────
  // The next-ideal-tool hint. Selecting any real tool counts as "the user
  // chose an option", which dismisses the active CAD hint (whether or not it
  // was the hinted one). Returning to 'select' is not a choice.
  const guidanceHint = useGuidanceStore(s => s.hint);
  useEffect(() => {
    if (activeTool !== 'select') useGuidanceStore.getState().clearHint('cad_');
  }, [activeTool]);

  // ── Logarithmic Extraction Tool (LET) ─────────────────────────────────────
  // Sends EVERY sheet on the active floor — plan sets split across multiple
  // files are merged into one room schedule server-side.
  const handleAiExtract = () => {
    useGuidanceStore.getState().clearHint('cad_');
    const state = useCadStore.getState();
    const floor = state.floors.find(f => f.id === state.activeFloorId);
    const underlays = floor?.underlays ?? [];
    if (underlays.length === 0) {
      toast.warning('Import a blueprint first (PDF or image), then run Logarithmic Extraction (LET).');
      return;
    }
    const sheets = underlays.slice(0, 6);
    if (underlays.length > 6) toast.warning('Using the first 6 sheets — the Logarithmic Extraction Tool caps at 6 per pass.');
    const name = sheets.length === 1 ? sheets[0].name : `${sheets[0].name} (+${sheets.length - 1} more sheet${sheets.length > 2 ? 's' : ''})`;
    state.setAiExtractRequest({ underlayName: name, dataUrls: sheets.map(u => u.dataUrl), underlayIds: sheets.map(u => u.id) });
  };

  // ── Vector trace ─────────────────────────────────────────────────────────
  // Exact geometry straight out of a CAD-plotted PDF. Operates on ONE sheet
  // (each page has its own vector space), so it takes the most recent import.
  const handleVectorTrace = () => {
    useGuidanceStore.getState().clearHint('cad_');
    const state = useCadStore.getState();
    const floor = state.floors.find(f => f.id === state.activeFloorId);
    const underlays = floor?.underlays ?? [];
    if (underlays.length === 0) {
      toast.warning('Import a blueprint PDF first, then trace its vector geometry.');
      return;
    }
    const sheet = underlays[underlays.length - 1];
    state.setVectorTraceRequest({ underlayId: sheet.id, underlayName: sheet.name });
  };

  // ── Image import ────────────────────────────────────────────────────────
  const handleImportImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    importUnderlayFiles(files);
    e.target.value = '';
  };

  // ── Tool rail registry — single source of the rail's contents ────────────
  // Registry order IS the default order; groupEnd marks where a section
  // divider renders. Dividers only show while the default order is active —
  // a custom arrangement is the user's own organization.
  const railItems: { id: string; groupEnd?: boolean; node: React.ReactNode }[] = [
    { id: 'select', node: <ToolButton id="select" icon={<MousePointer2 className="w-5 h-5" />} label="Select (V)" active={activeTool === 'select'} onClick={() => setActiveTool('select')} /> },
    { id: 'pan', groupEnd: true, node: <ToolButton id="pan" icon={<Hand className="w-5 h-5" />} label="Pan (H)" active={activeTool === 'pan'} onClick={() => setActiveTool('pan')} /> },
    { id: 'draw_wall', node: <ToolButton id="draw_wall" icon={<SquarePen className="w-5 h-5" />} label="Draw Wall (W)" active={activeTool === 'draw_wall'} onClick={() => setActiveTool('draw_wall')} glimmer={guidanceHint === 'cad_draw_wall'} /> },
    { id: 'place_window', node: <ToolButton id="place_window" icon={<LayoutGrid className="w-5 h-5" />} label="Add Window" active={activeTool === 'place_window'} onClick={() => setActiveTool('place_window')} /> },
    { id: 'place_door', groupEnd: true, node: <ToolButton id="place_door" icon={<DoorOpen className="w-5 h-5" />} label="Add Door" active={activeTool === 'place_door'} onClick={() => setActiveTool('place_door')} /> },
    { id: 'place_hvac', node: <ToolButton id="place_hvac" icon={<Wind className="w-5 h-5" />} label="HVAC Units" active={activeTool === 'place_hvac'} onClick={() => setActiveTool('place_hvac')} primary /> },
    { id: 'draw_pipe', node: <ToolButton id="draw_pipe" icon={<Cylinder className="w-5 h-5" />} label="Pipe Builder" active={activeTool === 'draw_pipe'} onClick={() => setActiveTool('draw_pipe')} primary /> },
    { id: 'draw_duct', node: <ToolButton id="draw_duct" icon={<GitBranch className="w-5 h-5" />} label="Draw Duct (X)" active={activeTool === 'draw_duct'} onClick={() => setActiveTool('draw_duct')} primary /> },
    { id: 'place_fitting', node: <ToolButton id="place_fitting" icon={<Diamond className="w-5 h-5" />} label="Place Fitting (J)" active={activeTool === 'place_fitting'} onClick={() => setActiveTool('place_fitting')} primary /> },
    {
      id: 'asset_library', groupEnd: true, node: (
        <div className="relative group">
          <button
            onClick={() => setShowAssetLibrary(true)}
            className={`p-3 mx-2 rounded-xl transition-all duration-300 group relative ${
              showAssetLibrary
                ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 shadow-[0_0_12px_rgba(52,211,153,0.15)]'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 border border-transparent'
            }`}
            aria-label="Asset Library"
          >
            <Package className="w-5 h-5" />
          </button>
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
            Asset Library
            <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
          </div>
        </div>
      )
    },
    { id: 'add_dimension', node: <ToolButton id="add_dimension" icon={<Ruler className="w-5 h-5" />} label="Dimension" active={activeTool === 'add_dimension'} onClick={() => setActiveTool('add_dimension')} /> },
    { id: 'add_label', node: <ToolButton id="add_label" icon={<Type className="w-5 h-5" />} label="Label" active={activeTool === 'add_label'} onClick={() => setActiveTool('add_label')} /> },
    { id: 'room_detect', node: <ToolButton id="room_detect" icon={<ScanLine className="w-5 h-5" />} label="Detect Rooms" active={activeTool === 'room_detect'} onClick={() => setActiveTool('room_detect')} glimmer={guidanceHint === 'cad_detect_rooms'} /> },
    {
      id: 'building_science', groupEnd: true, node: (
        <div className="relative group">
          <button
            onClick={() => setShowBuildingScience(v => !v)}
            className={`p-3 mx-2 rounded-xl transition-all duration-300 group relative ${showBuildingScience ? 'text-amber-50 bg-amber-500/20 border border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 border border-transparent'}`}
            aria-label="Building Science"
          >
            <Thermometer className="w-5 h-5" />
          </button>
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
            Building Science
            <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
          </div>
        </div>
      )
    },
    {
      id: 'import_blueprint', node: (
        <div className="relative group">
          <button
            onClick={handleImportImage}
            className="p-3 mx-2 rounded-xl transition-all duration-300 group relative text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 border border-transparent"
            aria-label="Import Blueprint (PDF or Image)"
          >
            <ImagePlus className="w-5 h-5" />
          </button>
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
            Import Blueprint (PDF / Image)
            <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
          </div>
        </div>
      )
    },
    { id: 'calibrate_scale', node: <ToolButton id="calibrate_scale" icon={<Crosshair className="w-5 h-5" />} label="Calibrate Scale" active={activeTool === 'calibrate_scale'} onClick={() => setActiveTool('calibrate_scale')} glimmer={guidanceHint === 'cad_calibrate_scale'} /> },
    {
      id: 'vector_trace', node: (
        <div className="relative group">
          <button
            onClick={handleVectorTrace}
            className="p-3 mx-2 rounded-xl transition-all duration-300 relative hover:bg-slate-800/80 border border-transparent min-h-[44px] min-w-[44px]"
            aria-label="Trace vector geometry from a CAD-plotted PDF"
          >
            <Ruler className="w-5 h-5 text-slate-300 group-hover:text-sky-300 transition-colors" />
          </button>
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
            Trace Vector Geometry — exact, from the PDF's own lines
            <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
          </div>
        </div>
      )
    },
    {
      id: 'ai_extract', node: (
        <div className="relative group">
          <button
            onClick={handleAiExtract}
            className={`p-3 mx-2 rounded-xl transition-all duration-300 group relative hover:bg-slate-800/80 border border-transparent${glimmerClass('cad_ai_extract', guidanceHint)}`}
            aria-label="Logarithmic Extraction Tool (review before import)"
          >
            {/* Glowing hexagon glyph — glow-on-transparent cut from the
                emblem art. Rendered at 36px (negative margin keeps the
                button's 44px footprint) so its detail reads in the rail. */}
            <img
              src={aiExtractIcon}
              alt=""
              aria-hidden
              className="w-9 h-9 -m-2 max-w-none group-hover:brightness-125 transition-[filter] duration-300"
            />
          </button>
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
            Logarithmic Extraction Tool
            <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
          </div>
        </div>
      )
    },
  ];

  const defaultIds = railItems.map(i => i.id);
  const orderedIds = (() => {
    if (!toolboxOrder) return defaultIds;
    // Saved order filtered to known ids; any tools shipped since the user
    // arranged append at the end (forward compat).
    const known = toolboxOrder.filter(id => defaultIds.includes(id));
    const missing = defaultIds.filter(id => !known.includes(id));
    return [...known, ...missing];
  })();
  const hasCustomOrder = !!toolboxOrder;
  // Rail shows the ordered VISIBLE tools; hidden ids wait in the tray.
  const visibleIds = orderedIds.filter(id => !toolboxHidden.includes(id));
  const hiddenIds = defaultIds.filter(id => toolboxHidden.includes(id));
  const renderIds = liveOrder ?? visibleIds;
  const railMap = new Map(railItems.map(i => [i.id, i]));

  // Remove a tool to the hidden tray / restore it to the rail. 'select' is
  // never removable — the rail always keeps a pointer. Hiding declutters
  // only; keyboard shortcuts still reach hidden tools.
  const removeTool = (id: string) => {
    if (id === 'select') return;
    updatePrefs({ toolboxHidden: [...toolboxHidden.filter(h => h !== id), id] });
  };
  const restoreTool = (id: string) => {
    updatePrefs({ toolboxHidden: toolboxHidden.filter(h => h !== id) });
  };

  const onArrangeDragStart = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const order = [...renderIds];
    const el = arrangeItemRefs.current[id];
    const rowH = Math.max(20, el ? el.getBoundingClientRect().height : 44);
    arrangeDragInfo.current = { id, startY: e.clientY, startIndex: order.indexOf(id), rowH, order };
    setDragToolId(id);
    liveOrderRef.current = order;
    setLiveOrder(order);

    const onMove = (me: PointerEvent) => {
      const d = arrangeDragInfo.current;
      if (!d) return;
      const delta = Math.round((me.clientY - d.startY) / d.rowH);
      const target = Math.max(0, Math.min(d.order.length - 1, d.startIndex + delta));
      const next = d.order.filter(x => x !== d.id);
      next.splice(target, 0, d.id);
      liveOrderRef.current = next;
      setLiveOrder(next);
    };

    const onUp = () => {
      const d = arrangeDragInfo.current;
      arrangeDragInfo.current = null;
      const final = liveOrderRef.current ?? (d ? d.order : null);
      setDragToolId(null);
      setLiveOrder(null);
      liveOrderRef.current = null;
      if (final) {
        // A result identical to the default keeps prefs at null so the
        // grouped layout (with dividers) stays in effect.
        const isDefault = final.length === defaultIds.length && final.every((x, i) => x === defaultIds[i]);
        updatePrefs({ toolboxOrder: isDefault ? null : final });
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HIDDEN when 3D viewer is open — toolbox only applies to 2D canvas
  // ═══════════════════════════════════════════════════════════════════════════
  if (is3DViewOpen) return null;

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLAPSED STATE — slim pill snapped to far left edge of browser
  // ═══════════════════════════════════════════════════════════════════════════
  if (!panelToolbox) {
    return (
      <>
        <button
          onClick={() => setPanelToolbox(true)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-[60] px-1.5 py-6 rounded-r-xl border border-l-0 border-slate-700/50 backdrop-blur-xl bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800/90 transition-all shadow-[0_0_24px_rgba(0,0,0,0.7)] group"
          title="Show Toolbox (T)"
        >
          <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </button>
        {showAssetLibrary && (
          <AssetLibrary isOpen={showAssetLibrary} onClose={() => setShowAssetLibrary(false)} />
        )}
      </>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPANDED STATE — floating draggable island
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={panelRef}
      className="fixed z-[60] pointer-events-auto select-none"
      style={{
        left: pos.x,
        top: pos.y,
        transform: `scale(${effectiveScale})`,
        transformOrigin: 'top left',
      }}
    >
      <div className="glass-panel rounded-2xl flex flex-col items-center shadow-[0_0_40px_rgba(0,0,0,0.8),0_4px_20px_rgba(0,0,0,0.4)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/70 transition-[background,border,shadow] duration-300 relative">

        {/* ── Top drag handle + collapse ──────────────────────────────── */}
        <div
          onPointerDown={onDragStart}
          className="w-full flex items-center justify-between px-1.5 pt-2.5 pb-1 cursor-grab active:cursor-grabbing"
        >
          <button
            onClick={(e) => { e.stopPropagation(); setPanelToolbox(false); }}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
            title="Collapse to edge (T)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <GripVertical className="w-3 h-3 text-slate-600" />

          {/* Arrange toggle — enter/exit tool-reorder mode */}
          <button
            onClick={(e) => { e.stopPropagation(); setArrangeMode(v => !v); }}
            className={`p-1 rounded-lg transition-colors ${arrangeMode ? 'text-emerald-300 bg-emerald-500/15' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/80'}`}
            title={arrangeMode ? 'Done arranging' : 'Arrange tools — drag rows to reorder'}
            aria-pressed={arrangeMode}
          >
            {arrangeMode ? <Check className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="w-8 h-px bg-slate-700/60 rounded-full" />

        {/* ── Tools — registry-ordered; user-arrangeable via the toggle ── */}
        <div className="py-1.5 flex flex-col items-center">
          {renderIds.map((id, idx) => {
            const item = railMap.get(id);
            if (!item) return null;
            const showDivider = !arrangeMode && !hasCustomOrder && item.groupEnd && idx < renderIds.length - 1;
            return (
              <React.Fragment key={id}>
                {arrangeMode ? (
                  <div
                    ref={(el) => { arrangeItemRefs.current[id] = el; }}
                    onPointerDown={(e) => onArrangeDragStart(e, id)}
                    className={`relative rounded-xl cursor-grab active:cursor-grabbing transition-shadow ${dragToolId === id ? 'ring-2 ring-emerald-400/70 bg-slate-800/80 z-10' : 'ring-1 ring-slate-700/60 hover:ring-slate-500/70'}`}
                  >
                    <div className="pointer-events-none">{item.node}</div>
                    {id !== 'select' && (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeTool(id); }}
                        className="absolute -top-1 -right-1 z-20 w-4 h-4 rounded-full bg-slate-800 border border-slate-600 text-slate-400 hover:text-red-300 hover:border-red-400/70 flex items-center justify-center transition-colors"
                        title="Remove from toolbox"
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  item.node
                )}
                {showDivider && <div className="w-8 h-px bg-slate-700/60 rounded-full my-1.5" />}
              </React.Fragment>
            );
          })}
          {/* Greater toolbox — hidden tools, only reachable from arrange mode */}
          {arrangeMode && hiddenIds.length > 0 && (
            <>
              <div className="w-8 h-px bg-slate-700/60 rounded-full my-1.5" />
              <div className="text-[8px] font-mono font-bold uppercase tracking-widest text-slate-600 mb-0.5 select-none">Hidden</div>
              {hiddenIds.map((id) => {
                const item = railMap.get(id);
                if (!item) return null;
                return (
                  <div key={id} className="relative rounded-xl ring-1 ring-slate-800/80 opacity-60 hover:opacity-90 transition-opacity">
                    <div className="pointer-events-none">{item.node}</div>
                    <button
                      onClick={() => restoreTool(id)}
                      className="absolute -top-1 -right-1 z-20 w-4 h-4 rounded-full bg-slate-800 border border-slate-600 text-slate-400 hover:text-emerald-300 hover:border-emerald-400/70 flex items-center justify-center transition-colors"
                      title="Add back to toolbox"
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </>
          )}
          {arrangeMode && (
            <button
              onClick={() => updatePrefs({ toolboxOrder: null, toolboxHidden: [] })}
              title="Reset toolbox — default order, all tools shown"
              className="mt-1 p-1.5 rounded-lg text-slate-500 hover:text-amber-300 hover:bg-slate-800/80 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        {/* ── Bottom: size controls + drag handle ────────────────────── */}
        <div className="w-8 h-px bg-slate-700/60 rounded-full" />
        <div className="flex items-center gap-1 mx-2 py-2">
          <button
            onClick={() => adjustScale(-0.1)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/80 transition-colors"
            title="Shrink toolbox"
          >
            <Minus className="w-3 h-3" />
          </button>
          <div
            onPointerDown={onDragStart}
            className="px-1.5 py-1 cursor-grab active:cursor-grabbing rounded-md hover:bg-slate-800/50 transition-colors"
            title="Drag to move"
          >
            <GripVertical className="w-3 h-3 text-slate-600" />
          </div>
          <button
            onClick={() => adjustScale(0.1)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/80 transition-colors"
            title="Grow toolbox"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

      </div>

      {/* Asset Library Modal */}
      {showAssetLibrary && (
        <AssetLibrary isOpen={showAssetLibrary} onClose={() => setShowAssetLibrary(false)} />
      )}

      {/* Building Science Panel */}
      <BuildingScience
        isOpen={showBuildingScience}
        onClose={() => setShowBuildingScience(false)}
        thermalOverlayEnabled={thermalOverlayEnabled}
        onToggleThermalOverlay={() => setThermalOverlayEnabled(!thermalOverlayEnabled)}
      />
    </div>
  );
}

interface ToolButtonProps {
  id: ToolType;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  primary?: boolean;
  /** Next-best-action guidance — adds the glimmer animation. */
  glimmer?: boolean;
}

function ToolButton({ icon, label, active, onClick, primary, glimmer }: ToolButtonProps) {
  const baseClass = `p-3 mx-2 rounded-xl transition-all duration-300 group relative${glimmer ? ' guidance-glimmer' : ''}`;

  let stateClass = "text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 border border-transparent";

  if (active) {
    if (primary) {
      stateClass = "text-emerald-50 bg-emerald-500/20 border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.3)]";
    } else {
      stateClass = "text-sky-50 bg-sky-500/20 border border-sky-500/50 shadow-[0_0_20px_rgba(14,165,233,0.3)]";
    }
  } else if (primary) {
    stateClass = "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-transparent";
  }

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`${baseClass} ${stateClass}`}
        aria-label={label}
      >
        {icon}
      </button>

      {/* Tooltip */}
      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
        {label}
        <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
      </div>
    </div>
  );
}
