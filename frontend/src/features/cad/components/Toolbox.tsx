import React, { useRef, useState, useCallback, useEffect } from 'react';
import { MousePointer2, Hand, SquarePen, LayoutGrid, DoorOpen, Wind, Ruler, Type, ScanLine, ImagePlus, Package, Thermometer, ChevronLeft, ChevronRight, Cylinder, GitBranch, Diamond, Minus, Plus, GripVertical } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import type { ToolType, UnderlayImage } from '../store/useCadStore';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
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

  // Auto-center vertically on first mount (y=-1 sentinel) or clamp to viewport
  useEffect(() => {
    if (!panelRef.current) return;
    const h = panelRef.current.getBoundingClientRect().height;
    const w = panelRef.current.getBoundingClientRect().width;

    if (pos.y === -1 && !autoCentered) {
      // First mount — center vertically
      const vy = Math.max(EDGE_MARGIN, (window.innerHeight - h) / 2);
      setPos(p => ({ ...p, y: vy }));
      setAutoCentered(true);
    } else if (!autoCentered) {
      // Saved position — clamp to current viewport so toolbox is always visible
      const maxX = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
      const maxY = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
      const clampedX = Math.max(EDGE_MARGIN, Math.min(maxX, pos.x));
      const clampedY = Math.max(EDGE_MARGIN, Math.min(maxY, pos.y));
      if (clampedX !== pos.x || clampedY !== pos.y) {
        setPos({ x: clampedX, y: clampedY });
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

      setPos({
        x: Math.round(Math.max(EDGE_MARGIN, Math.min(maxX, dragStart.current.ox + dx))),
        y: Math.round(Math.max(EDGE_MARGIN, Math.min(maxY, dragStart.current.oy + dy))),
      });
    };

    const onUp = () => {
      dragging.current = false;
      // Persist final position
      const ps = usePreferencesStore.getState().panelSizes;
      setPos(p => {
        updatePrefs({ panelSizes: { ...ps, toolboxPos: { x: p.x, y: p.y } } });
        return p;
      });
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

    // Re-clamp position so the toolbox stays within viewport after scaling
    requestAnimationFrame(() => {
      if (!panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - EDGE_MARGIN;
      const maxY = window.innerHeight - rect.height - EDGE_MARGIN;
      setPos(p => {
        const nx = Math.max(EDGE_MARGIN, Math.min(maxX, p.x));
        const ny = Math.max(EDGE_MARGIN, Math.min(maxY, p.y));
        if (nx !== p.x || ny !== p.y) {
          const latest = usePreferencesStore.getState().panelSizes;
          updatePrefs({ panelSizes: { ...latest, toolboxPos: { x: nx, y: ny } } });
          return { x: nx, y: ny };
        }
        return p;
      });
    });
  };

  // ── Image import ────────────────────────────────────────────────────────
  const handleImportImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      processImageFile(files[i]);
    }
    e.target.value = '';
  };

  const processImageFile = (file: File) => {
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_IMAGE_SIZE) {
      alert(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
      return;
    }
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
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const maxW = 600;
        const maxH = 400;
        if (w > maxW) { const r = maxW / w; w *= r; h *= r; }
        if (h > maxH) { const r = maxH / h; w *= r; h *= r; }

        const state = useCadStore.getState();
        const canvas = state.canvas;
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

        state.addUnderlay(underlayImg);
        state.markDirty();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
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
        transform: `scale(${toolboxScale})`,
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

          {/* Spacer to balance */}
          <div className="w-5" />
        </div>

        <div className="w-8 h-px bg-slate-700/60 rounded-full" />

        {/* ── Tools ──────────────────────────────────────────────────── */}
        <div className="py-1.5">
          <ToolButton
            id="select"
            icon={<MousePointer2 className="w-5 h-5" />}
            label="Select (V)"
            active={activeTool === 'select'}
            onClick={() => setActiveTool('select')}
          />

          <ToolButton
            id="pan"
            icon={<Hand className="w-5 h-5" />}
            label="Pan (H)"
            active={activeTool === 'pan'}
            onClick={() => setActiveTool('pan')}
          />
        </div>

        <div className="w-8 h-px bg-slate-700/60 rounded-full" />

        <div className="py-1.5">
          <ToolButton
            id="draw_wall"
            icon={<SquarePen className="w-5 h-5" />}
            label="Draw Wall (W)"
            active={activeTool === 'draw_wall'}
            onClick={() => setActiveTool('draw_wall')}
          />

          <ToolButton
            id="place_window"
            icon={<LayoutGrid className="w-5 h-5" />}
            label="Add Window"
            active={activeTool === 'place_window'}
            onClick={() => setActiveTool('place_window')}
          />

          <ToolButton
            id="place_door"
            icon={<DoorOpen className="w-5 h-5" />}
            label="Add Door"
            active={activeTool === 'place_door'}
            onClick={() => setActiveTool('place_door')}
          />
        </div>

        <div className="w-8 h-px bg-slate-700/60 rounded-full" />

        <div className="py-1.5">
          <ToolButton
            id="place_hvac"
            icon={<Wind className="w-5 h-5" />}
            label="HVAC Units"
            active={activeTool === 'place_hvac'}
            onClick={() => setActiveTool('place_hvac')}
            primary
          />

          <ToolButton
            id="draw_pipe"
            icon={<Cylinder className="w-5 h-5" />}
            label="Pipe Builder"
            active={activeTool === 'draw_pipe'}
            onClick={() => setActiveTool('draw_pipe')}
            primary
          />

          <ToolButton
            id="draw_duct"
            icon={<GitBranch className="w-5 h-5" />}
            label="Draw Duct (X)"
            active={activeTool === 'draw_duct'}
            onClick={() => setActiveTool('draw_duct')}
            primary
          />

          <ToolButton
            id="place_fitting"
            icon={<Diamond className="w-5 h-5" />}
            label="Place Fitting (J)"
            active={activeTool === 'place_fitting'}
            onClick={() => setActiveTool('place_fitting')}
            primary
          />

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
        </div>

        <div className="w-8 h-px bg-slate-700/60 rounded-full" />

        <div className="py-1.5">
          <ToolButton
            id="add_dimension"
            icon={<Ruler className="w-5 h-5" />}
            label="Dimension"
            active={activeTool === 'add_dimension'}
            onClick={() => setActiveTool('add_dimension')}
          />

          <ToolButton
            id="add_label"
            icon={<Type className="w-5 h-5" />}
            label="Label"
            active={activeTool === 'add_label'}
            onClick={() => setActiveTool('add_label')}
          />

          <ToolButton
            id="room_detect"
            icon={<ScanLine className="w-5 h-5" />}
            label="Detect Rooms"
            active={activeTool === 'room_detect'}
            onClick={() => setActiveTool('room_detect')}
          />

          {/* Building Science — thermal interop */}
          <div className="relative group">
            <button
              onClick={() => setShowBuildingScience(v => !v)}
              className={`p-3 mx-2 rounded-xl transition-all duration-300 group relative ${showBuildingScience ? 'text-amber-50 bg-amber-500/20 border border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 border border-transparent'}`}
              aria-label="Building Science (B)"
            >
              <Thermometer className="w-5 h-5" />
            </button>
            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
              Building Science (B)
              <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
            </div>
          </div>
        </div>

        <div className="w-8 h-px bg-slate-700/60 rounded-full" />

        {/* Import image */}
        <div className="py-1.5">
          <div className="relative group">
            <button
              onClick={handleImportImage}
              className="p-3 mx-2 rounded-xl transition-all duration-300 group relative text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 border border-transparent"
              aria-label="Import Image"
            >
              <ImagePlus className="w-5 h-5" />
            </button>
            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
              Import Image
              <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
            </div>
          </div>
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
}

function ToolButton({ icon, label, active, onClick, primary }: ToolButtonProps) {
  const baseClass = "p-3 mx-2 rounded-xl transition-all duration-300 group relative";

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
