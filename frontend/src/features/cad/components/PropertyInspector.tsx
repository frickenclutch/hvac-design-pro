import { useState, useMemo, useCallback } from 'react';
import { useCadStore } from '../store/useCadStore';
import type { WallMaterial, Opening, HvacUnit, PipeSegment, PipeMaterial, DetectedRoom, UnderlayImage, Annotation, DuctSegment, DuctFitting, DuctShape, DuctMaterial, DuctSide, DuctRole, FittingType } from '../store/useCadStore';
import { fmtLength, fmtArea, fmtTemp, smallLengthUnit } from '../../../utils/units';
import { Settings2, Layers, Ruler, Triangle, Wind, DoorOpen, LayoutGrid, ScanLine, ImageIcon, Lock, Unlock, Trash2, Type, RotateCcw, Bold, Italic, AlignLeft, AlignCenter, AlignRight, ChevronLeft, ChevronRight, GitBranch, Diamond, Minus, Plus } from 'lucide-react';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
import PanelResizeHandle from './PanelResizeHandle';

/** Extract name from a Fabric object (all CAD objects carry a .name string). */
function fabricName(obj: unknown): string | undefined {
  return (obj as { name?: string })?.name;
}

const MATERIAL_LABELS: Record<WallMaterial, string> = {
  insulated_stud: 'Insulated Wood Stud',
  cmu: 'CMU Block',
  concrete: 'Poured Concrete',
};

const HVAC_TYPE_LABELS: Record<string, string> = {
  supply_register: 'Supply Register',
  return_grille: 'Return Grille',
  air_handler: 'Air Handler',
  condenser: 'Condenser',
  thermostat: 'Thermostat',
  duct_run: 'Duct Run',
};

// Auto-compute U-Factor from R-Value
const uFactor = (r: number) => (r > 0 ? (1 / r).toFixed(4) : '—');

export default function PropertyInspector() {
  const { selectedObject, selectedWallId, setSelectedWallId, setSelectedObject, canvas, walls, updateWall, removeWall, updateOpening, removeOpening, updateHvacUnit, removeHvacUnit, removePipe, updateUnderlay, removeUnderlay, updateAnnotation, removeAnnotation, markDirty, floors, activeFloorId, panelProperties, setPanelProperties, is3DViewOpen } = useCadStore();

  const floor = floors.find(f => f.id === activeFloorId);

  // Find the selected wall if one is active
  const selectedWall = selectedWallId ? walls.find((w) => w.id === selectedWallId) ?? null : null;

  // Detect selected opening or HVAC unit from fabric object name
  const selectedOpening = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = fabricName(selectedObject);
    if (!name?.startsWith('opening-')) return null;
    const id = name.replace('opening-', '');
    return floor.openings.find(o => o.id === id) ?? null;
  }, [selectedObject, floor]);

  const selectedHvac = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = fabricName(selectedObject);
    if (!name?.startsWith('hvac-')) return null;
    const id = name.replace('hvac-', '');
    return floor.hvacUnits.find(u => u.id === id) ?? null;
  }, [selectedObject, floor]);

  const selectedUnderlay = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = fabricName(selectedObject);
    if (!name?.startsWith('underlay-')) return null;
    const id = name.replace('underlay-', '');
    return floor.underlays?.find(u => u.id === id) ?? null;
  }, [selectedObject, floor]);

  const selectedAnnotation = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = fabricName(selectedObject);
    if (!name?.startsWith('ann-')) return null;
    const id = name.replace('ann-', '');
    return floor.annotations.find(a => a.id === id) ?? null;
  }, [selectedObject, floor]);

  const selectedPipe = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = fabricName(selectedObject);
    if (!name?.startsWith('pipe-')) return null;
    const id = name.replace('pipe-', '');
    return (floor.pipes ?? []).find(p => p.id === id) ?? null;
  }, [selectedObject, floor]);

  const selectedDuct = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = fabricName(selectedObject);
    if (!name?.startsWith('duct-')) return null;
    const id = name.replace('duct-', '');
    return (floor.ductSegments ?? []).find(d => d.id === id) ?? null;
  }, [selectedObject, floor]);

  const selectedFitting = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = fabricName(selectedObject);
    if (!name?.startsWith('fitting-')) return null;
    const id = name.replace('fitting-', '');
    return (floor.ductFittings ?? []).find(f => f.id === id) ?? null;
  }, [selectedObject, floor]);

  const panelWidth = usePreferencesStore(s => s.panelSizes.propertiesWidth);
  const propertiesScale = usePreferencesStore(s => s.panelSizes.propertiesScale ?? 1);
  const updatePrefs = usePreferencesStore(s => s.update);
  const handleResize = useCallback((w: number) => {
    updatePrefs({ panelSizes: { ...usePreferencesStore.getState().panelSizes, propertiesWidth: w } });
  }, [updatePrefs]);

  const adjustPropertiesScale = useCallback((delta: number) => {
    const ps = usePreferencesStore.getState().panelSizes;
    const current = ps.propertiesScale ?? 1;
    const next = Math.round(Math.min(1.25, Math.max(0.7, current + delta)) * 100) / 100;
    updatePrefs({ panelSizes: { ...ps, propertiesScale: next } });
  }, [updatePrefs]);

  const headerText = selectedWall ? 'Wall Selected' : selectedOpening ? 'Opening Selected' : selectedHvac ? 'HVAC Unit Selected' : selectedPipe ? 'Pipe Selected' : selectedDuct ? 'Duct Segment Selected' : selectedFitting ? 'Duct Fitting Selected' : selectedUnderlay ? 'Underlay Selected' : selectedAnnotation ? 'Label Selected' : selectedObject ? 'Object Selected' : 'Canvas Settings';

  // Hidden in 3D view
  if (is3DViewOpen) return null;

  if (!panelProperties) {
    return (
      <div className="absolute right-3 top-24 z-10">
        <button
          onClick={() => setPanelProperties(true)}
          className="p-2 glass-panel rounded-xl border border-slate-700/50 backdrop-blur-xl bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800 transition-all shadow-[0_0_20px_rgba(0,0,0,0.6)]"
          title="Show Properties (P)"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute right-6 top-24 bottom-6 z-10 pointer-events-none" style={{ width: panelWidth, transform: `scale(${propertiesScale})`, transformOrigin: 'top right' }}>
      <div className="h-full glass-panel rounded-2xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/70 overflow-hidden pointer-events-auto transition-[background,border,shadow] duration-500 transform origin-right relative">
        <PanelResizeHandle edge="left" currentWidth={panelWidth} onResize={handleResize} minWidth={220} maxWidth={520} />

        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">Properties</h3>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => adjustPropertiesScale(-0.1)} className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/80 transition-colors" title="Shrink panel">
                <Minus className="w-3 h-3" />
              </button>
              <button onClick={() => adjustPropertiesScale(0.1)} className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/80 transition-colors" title="Grow panel">
                <Plus className="w-3 h-3" />
              </button>
              <button
                onClick={() => setPanelProperties(false)}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
                title="Hide Properties (P)"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 font-mono">{headerText}</p>
        </div>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">

          {/* ── WALL SELECTED ── */}
          {selectedWall ? (
            <WallPanel
              wall={selectedWall}
              onUpdate={(patch) => updateWall(selectedWall.id, patch)}
            />

          ) : selectedOpening ? (
            <OpeningPanel opening={selectedOpening} onUpdate={(patch) => updateOpening(selectedOpening.id, patch)} />

          ) : selectedHvac ? (
            <HvacPanel unit={selectedHvac} onUpdate={(patch) => updateHvacUnit(selectedHvac.id, patch)} />

          ) : selectedPipe ? (
            <PipePanel pipe={selectedPipe} onUpdate={(patch) => useCadStore.getState().updatePipe(selectedPipe.id, patch)} />

          ) : selectedDuct ? (
            <DuctSegmentPanel duct={selectedDuct} onUpdate={(patch) => { useCadStore.getState().updateDuctSegment(selectedDuct.id, patch); useCadStore.getState().markDirty(); }} />

          ) : selectedFitting ? (
            <DuctFittingPanel fitting={selectedFitting} onUpdate={(patch) => { useCadStore.getState().updateDuctFitting(selectedFitting.id, patch); useCadStore.getState().markDirty(); }} />

          ) : selectedUnderlay ? (
            <UnderlayPanel
              underlay={selectedUnderlay}
              onUpdate={(patch) => updateUnderlay(selectedUnderlay.id, patch)}
              onDelete={() => {
                removeUnderlay(selectedUnderlay.id);
                useCadStore.getState().setSelectedObject(null);
              }}
            />

          ) : selectedAnnotation && selectedAnnotation.type === 'label' ? (
            <AnnotationPanel annotation={selectedAnnotation} onUpdate={(patch) => { updateAnnotation(selectedAnnotation.id, patch); useCadStore.getState().markDirty(); }} />

          ) : floor && floor.rooms.length > 0 && !selectedObject ? (
            <RoomSummaryPanel rooms={floor.rooms} />

          ) : !selectedObject ? (
            /* ── DEFAULT (no selection) ── */
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500 fade-in">
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Layers className="w-3 h-3" /> Project Defaults
                </h4>
                <PropertyField label="Default Ceiling Height" value={fmtLength(9, 0)} />
                <PropertyField label="Zone Type" value="Conditioned Space" />
                <PropertyField label="Design Temp (Cooling)" value={fmtTemp(75)} />
                <PropertyField label="Design Temp (Heating)" value={fmtTemp(70)} />
              </div>
              <AppearancePanel />
            </div>
          ) : (
            /* ── GENERIC OBJECT SELECTED ── */
            <div className="space-y-6 animate-in zoom-in-95 duration-300 fade-in">
              <div>
                <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-4">Object Details</h4>
                <PropertyField
                  label="Type"
                  value={selectedObject.type === 'rect' ? 'Room Area' : selectedObject.type || 'Unknown'}
                  isReadOnly
                />
                <PropertyField label="Position X" value={selectedObject.left?.toFixed(2) || '0'} isReadOnly />
                <PropertyField label="Position Y" value={selectedObject.top?.toFixed(2) || '0'} isReadOnly />
              </div>
            </div>
          )}

          {/* ── Delete Action (shown for any selected entity) ── */}
          {(selectedWall || selectedOpening || selectedHvac || selectedPipe || selectedDuct || selectedFitting || selectedAnnotation) && (
            <div className="mt-6 pt-4 border-t border-slate-800/50">
              <button
                onClick={() => {
                  if (selectedWall) {
                    removeWall(selectedWall.id);
                    setSelectedWallId(null);
                  } else if (selectedOpening) {
                    removeOpening(selectedOpening.id);
                  } else if (selectedHvac) {
                    removeHvacUnit(selectedHvac.id);
                  } else if (selectedPipe) {
                    removePipe(selectedPipe.id);
                  } else if (selectedDuct) {
                    useCadStore.getState().removeDuctSegment(selectedDuct.id);
                  } else if (selectedFitting) {
                    useCadStore.getState().removeDuctFitting(selectedFitting.id);
                  } else if (selectedAnnotation) {
                    removeAnnotation(selectedAnnotation.id);
                  }
                  setSelectedObject(null);
                  markDirty();
                  canvas?.discardActiveObject();
                  canvas?.requestRenderAll();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-red-400 bg-red-500/5 border border-red-500/20 hover:bg-red-500/10 hover:text-red-300 transition-all text-sm font-semibold"
              >
                <Trash2 className="w-4 h-4" /> Delete Selected
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Wall-specific panel ──────────────────────────────────────────────────────
interface WallPanelProps {
  wall: NonNullable<ReturnType<typeof useCadStore.getState>['walls'][0]>;
  onUpdate: (patch: Parameters<ReturnType<typeof useCadStore.getState>['updateWall']>[1]) => void;
}

function WallPanel({ wall, onUpdate }: WallPanelProps) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  // Use projectScale from store for the length calculation
  const pxPerFt = useCadStore.getState().projectScale.pxPerFt;
  const lengthFt = (Math.sqrt(dx * dx + dy * dy) / pxPerFt).toFixed(2);

  const [localR, setLocalR] = useState(wall.rValue.toString());
  const [localThickness, setLocalThickness] = useState(wall.thicknessIn.toString());

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">

      {/* Geometry */}
      <div>
        <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Ruler className="w-3 h-3" /> Geometry
        </h4>
        <PropertyField label="Length" value={fmtLength(parseFloat(lengthFt))} isReadOnly />
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
            Thickness ({smallLengthUnit()})
          </label>
          <input
            type="number"
            value={localThickness}
            onChange={(e) => setLocalThickness(e.target.value)}
            onBlur={() => {
              const v = parseFloat(localThickness);
              if (!isNaN(v) && v > 0) onUpdate({ thicknessIn: v });
            }}
            step="0.25"
            min="1"
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
          />
        </div>
      </div>

      {/* Thermal Properties */}
      <div className="pt-4 border-t border-slate-800">
        <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Triangle className="w-3 h-3" /> Thermal Properties
        </h4>

        {/* Material dropdown */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
            Material
          </label>
          <select
            value={wall.material}
            onChange={(e) => onUpdate({ material: e.target.value as WallMaterial })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner appearance-none cursor-pointer"
          >
            {(Object.keys(MATERIAL_LABELS) as WallMaterial[]).map((m) => (
              <option key={m} value={m} className="bg-slate-900">
                {MATERIAL_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
            R-Value
          </label>
          <input
            type="number"
            value={localR}
            onChange={(e) => setLocalR(e.target.value)}
            onBlur={() => {
              const v = parseFloat(localR);
              if (!isNaN(v) && v >= 0) onUpdate({ rValue: v });
            }}
            step="1"
            min="0"
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
          />
        </div>

        {/* Auto-computed U-Factor */}
        <PropertyField
          label="U-Factor (auto)"
          value={uFactor(wall.rValue)}
          isReadOnly
        />

        {/* Thermal grade indicator */}
        <div className="mt-3 p-2.5 rounded-lg border" style={{
          borderColor: wall.rValue >= 21 ? '#22c55e40' : wall.rValue >= 13 ? '#3b82f640' : wall.rValue >= 7 ? '#f59e0b40' : '#ef444440',
          backgroundColor: wall.rValue >= 21 ? '#22c55e08' : wall.rValue >= 13 ? '#3b82f608' : wall.rValue >= 7 ? '#f59e0b08' : '#ef444408',
        }}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Thermal Grade</span>
            <span className="text-[10px] font-bold" style={{
              color: wall.rValue >= 21 ? '#22c55e' : wall.rValue >= 13 ? '#3b82f6' : wall.rValue >= 7 ? '#f59e0b' : '#ef4444',
            }}>
              {wall.rValue >= 21 ? 'Excellent' : wall.rValue >= 13 ? 'Good' : wall.rValue >= 7 ? 'Fair' : 'Poor'}
            </span>
          </div>
        </div>
      </div>

      {/* Identification */}
      <div className="pt-4 border-t border-slate-800">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          ID
        </h4>
        <PropertyField label="Wall ID" value={wall.id.slice(0, 20) + '…'} isReadOnly />
      </div>

    </div>
  );
}

// ── Door size presets ────────────────────────────────────────────────────────
const DOOR_SIZE_PRESETS = [
  { label: '24" x 80"', w: 24, h: 80, desc: 'Closet' },
  { label: '30" x 80"', w: 30, h: 80, desc: 'Std Interior' },
  { label: '32" x 80"', w: 32, h: 80, desc: 'Standard' },
  { label: '36" x 80"', w: 36, h: 80, desc: 'Wide/ADA' },
  { label: '48" x 80"', w: 48, h: 80, desc: 'Double' },
  { label: '72" x 80"', w: 72, h: 80, desc: 'Sliding Patio' },
];

// ── Opening panel ────────────────────────────────────────────────────────────
function OpeningPanel({ opening, onUpdate }: { opening: Opening; onUpdate: (patch: Partial<Opening>) => void }) {
  const isWindow = opening.type === 'window';
  const isDoor = opening.type === 'door' || opening.type === 'sliding_door';
  const [localWidth, setLocalWidth] = useState(opening.widthIn.toString());
  const [localHeight, setLocalHeight] = useState(opening.heightIn.toString());

  const applyAndSync = (patch: Partial<Opening>) => {
    onUpdate(patch);
    useCadStore.getState().markDirty();
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          {isWindow ? <LayoutGrid className="w-3 h-3" /> : <DoorOpen className="w-3 h-3" />}
          {isWindow ? 'Window' : 'Door'} Properties
        </h4>
        <PropertyField label="Type" value={opening.type.replace('_', ' ')} isReadOnly />
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Width ({smallLengthUnit()})</label>
          <input type="number" value={localWidth} onChange={e => setLocalWidth(e.target.value)}
            onBlur={() => { const v = parseFloat(localWidth); if (!isNaN(v) && v > 0) applyAndSync({ widthIn: v }); }}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
        </div>
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Height ({smallLengthUnit()})</label>
          <input type="number" value={localHeight} onChange={e => setLocalHeight(e.target.value)}
            onBlur={() => { const v = parseFloat(localHeight); if (!isNaN(v) && v > 0) applyAndSync({ heightIn: v }); }}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
        </div>
        <PropertyField label="Position" value={`${(opening.positionAlongWall * 100).toFixed(0)}% along wall`} isReadOnly />
      </div>

      {/* Swing Direction Toggle (door types only) */}
      {isDoor && (
        <div className="pt-4 border-t border-slate-800">
          <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <RotateCcw className="w-3 h-3" /> Swing Direction
          </h4>
          <div className="flex gap-1 mb-4">
            {(['left', 'right', 'double'] as const).map((dir) => {
              const isActive = opening.swingDirection === dir;
              return (
                <button
                  key={dir}
                  onClick={() => applyAndSync({ swingDirection: dir })}
                  className={`flex-1 flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border text-xs font-semibold transition-all ${
                    isActive
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                      : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {/* SVG swing arc icons */}
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
                    {dir === 'left' && (
                      <>
                        <line x1="4" y1="4" x2="4" y2="20" />
                        <path d="M4 20 Q4 4 20 20" strokeDasharray="3 2" />
                      </>
                    )}
                    {dir === 'right' && (
                      <>
                        <line x1="20" y1="4" x2="20" y2="20" />
                        <path d="M20 20 Q20 4 4 20" strokeDasharray="3 2" />
                      </>
                    )}
                    {dir === 'double' && (
                      <>
                        <line x1="4" y1="4" x2="4" y2="20" />
                        <line x1="20" y1="4" x2="20" y2="20" />
                        <path d="M4 20 Q4 10 12 20" strokeDasharray="3 2" />
                        <path d="M20 20 Q20 10 12 20" strokeDasharray="3 2" />
                      </>
                    )}
                  </svg>
                  <span className="capitalize">{dir}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Scale Presets (door types only) */}
      {isDoor && (
        <div className="pt-4 border-t border-slate-800">
          <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Ruler className="w-3 h-3" /> Quick Size Presets
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {DOOR_SIZE_PRESETS.map((preset) => {
              const isActive = opening.widthIn === preset.w && opening.heightIn === preset.h;
              return (
                <button
                  key={preset.label}
                  onClick={() => {
                    setLocalWidth(preset.w.toString());
                    setLocalHeight(preset.h.toString());
                    applyAndSync({ widthIn: preset.w, heightIn: preset.h });
                  }}
                  className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${
                    isActive
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                      : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                  }`}
                  title={preset.desc}
                >
                  {preset.label}
                  <span className="block text-[8px] text-slate-600 font-normal">{preset.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isWindow && (
        <div className="pt-4 border-t border-slate-800">
          <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Triangle className="w-3 h-3" /> Thermal
          </h4>
          <PropertyField label="U-Factor" value={opening.uFactor?.toFixed(3) ?? '—'} isReadOnly />
          <PropertyField label="SHGC" value={opening.shgc?.toFixed(2) ?? '—'} isReadOnly />
        </div>
      )}

      <div className="pt-4 border-t border-slate-800">
        <PropertyField label="ID" value={opening.id.slice(0, 20) + '...'} isReadOnly />
      </div>
    </div>
  );
}

// ── HVAC panel ───────────────────────────────────────────────────────────────
function HvacPanel({ unit, onUpdate }: { unit: HvacUnit; onUpdate: (patch: Partial<HvacUnit>) => void }) {
  const [localCfm, setLocalCfm] = useState((unit.cfm ?? 0).toString());
  const [localLabel, setLocalLabel] = useState(unit.label ?? '');

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Wind className="w-3 h-3" /> HVAC Unit
        </h4>
        <PropertyField label="Type" value={HVAC_TYPE_LABELS[unit.type] ?? unit.type} isReadOnly />
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Label</label>
          <input type="text" value={localLabel} onChange={e => setLocalLabel(e.target.value)}
            onBlur={() => onUpdate({ label: localLabel })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
        </div>
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">CFM</label>
          <input type="number" value={localCfm} onChange={e => setLocalCfm(e.target.value)}
            onBlur={() => { const v = parseFloat(localCfm); if (!isNaN(v) && v >= 0) onUpdate({ cfm: v }); }}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
        </div>
        <PropertyField label="Rotation" value={`${unit.rotation}°`} isReadOnly />
        <PropertyField label="Position" value={`(${unit.x.toFixed(0)}, ${unit.y.toFixed(0)})`} isReadOnly />
      </div>
      <div className="pt-4 border-t border-slate-800">
        <PropertyField label="ID" value={unit.id.slice(0, 20) + '…'} isReadOnly />
      </div>
    </div>
  );
}

// ── Pipe panel ──────────────────────────────────────────────────────────────
const PIPE_MATERIAL_LABELS: Record<string, string> = {
  copper_liquid: 'Copper — Liquid Line',
  copper_suction: 'Copper — Suction Line',
  pvc_condensate: 'PVC — Condensate Drain',
  gas_black_iron: 'Black Iron — Gas Line',
};

function PipePanel({ pipe, onUpdate }: { pipe: PipeSegment; onUpdate: (patch: Partial<PipeSegment>) => void }) {
  const pxPerFt = useCadStore.getState().projectScale.pxPerFt;
  const dx = pipe.x2 - pipe.x1;
  const dy = pipe.y2 - pipe.y1;
  const lengthFt = (Math.sqrt(dx * dx + dy * dy) / pxPerFt).toFixed(2);

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-pink-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          Pipe Segment
        </h4>
        <PropertyField label="Material" value={PIPE_MATERIAL_LABELS[pipe.material] ?? pipe.material} isReadOnly />
        <PropertyField label="Length" value={`${lengthFt} ft`} isReadOnly />
        <PropertyField label="Diameter" value={`${pipe.diameterIn}" OD`} isReadOnly />

        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Material Type</label>
          <select
            value={pipe.material}
            onChange={(e) => onUpdate({ material: e.target.value as PipeMaterial })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
          >
            {Object.entries(PIPE_MATERIAL_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Diameter (in)</label>
          <select
            value={pipe.diameterIn}
            onChange={(e) => onUpdate({ diameterIn: parseFloat(e.target.value) })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
          >
            {[0.375, 0.5, 0.625, 0.75, 0.875, 1.0, 1.125, 1.375, 1.625, 2.125].map(d => (
              <option key={d} value={d}>{d}"</option>
            ))}
          </select>
        </div>
      </div>

      {/* Thermal info */}
      <div className="pt-4 border-t border-slate-800">
        <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">Thermal</h4>
        <PropertyField label="Line Type" value={pipe.material.includes('suction') ? 'Cold (Insulated)' : pipe.material.includes('liquid') ? 'Warm' : pipe.material.includes('gas') ? 'Hot' : 'Ambient'} isReadOnly />
        <PropertyField label="Est. Heat Loss" value={`${(parseFloat(lengthFt) * (pipe.material.includes('suction') ? 4.2 : pipe.material.includes('liquid') ? 1.8 : 0.5)).toFixed(0)} BTU/hr`} isReadOnly />
      </div>

      <div className="pt-4 border-t border-slate-800">
        <PropertyField label="ID" value={pipe.id.slice(0, 20) + '…'} isReadOnly />
      </div>
    </div>
  );
}

// ── Duct segment panel ─────────────────────────────────────────────────────
const DUCT_SHAPE_LABELS: Record<DuctShape, string> = {
  round: 'Round',
  rectangular: 'Rectangular',
  oval: 'Oval',
};

const DUCT_MATERIAL_LABELS: Record<DuctMaterial, string> = {
  sheet_metal: 'Sheet Metal',
  flex_r4: 'Flex Duct (R-4)',
  flex_r6: 'Flex Duct (R-6)',
  flex_r8: 'Flex Duct (R-8)',
  spiral: 'Spiral',
  fiberglass_board: 'Fiberglass Board',
  fabric: 'Fabric Duct',
  pvc: 'PVC',
};

const DUCT_SIDE_LABELS: Record<DuctSide, string> = {
  supply: 'Supply',
  return: 'Return',
};

const DUCT_ROLE_LABELS: Record<DuctRole, string> = {
  trunk: 'Trunk',
  branch: 'Branch',
  plenum: 'Plenum',
  takeoff: 'Takeoff',
  runout: 'Runout',
};

const FITTING_TYPE_LABELS: Record<FittingType, string> = {
  elbow_90: '90° Elbow',
  elbow_45: '45° Elbow',
  elbow_radius: 'Radius Elbow',
  tee_branch: 'Tee (Branch)',
  tee_straight: 'Tee (Straight)',
  wye: 'Wye',
  reducer: 'Reducer',
  transition_rect_round: 'Transition (Rect→Round)',
  end_cap: 'End Cap',
  register_boot: 'Register Boot',
  return_boot: 'Return Boot',
  takeoff_round: 'Takeoff (Round)',
  takeoff_rect: 'Takeoff (Rect)',
  damper_manual: 'Manual Damper',
  damper_motorized: 'Motorized Damper',
  splitter: 'Splitter',
  turning_vanes: 'Turning Vanes',
};

function DuctSegmentPanel({ duct, onUpdate }: { duct: DuctSegment; onUpdate: (patch: Partial<DuctSegment>) => void }) {
  const pxPerFt = useCadStore.getState().projectScale.pxPerFt;
  const dx = duct.x2 - duct.x1;
  const dy = duct.y2 - duct.y1;
  const lengthFt = (Math.sqrt(dx * dx + dy * dy) / pxPerFt).toFixed(2);

  const [_localDiameter, _setLocalDiameter] = useState((duct.diameterIn ?? 12).toString());
  const [localWidth, setLocalWidth] = useState((duct.widthIn ?? 12).toString());
  const [localHeight, setLocalHeight] = useState((duct.heightIn ?? 8).toString());
  const [localCfm, setLocalCfm] = useState((duct.cfm ?? 0).toString());

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <GitBranch className="w-3 h-3" /> Duct Segment
        </h4>
        <PropertyField label="Length" value={`${lengthFt} ft`} isReadOnly />

        {/* Side: Supply / Return */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Side</label>
          <div className="flex gap-1">
            {(['supply', 'return'] as DuctSide[]).map((s) => (
              <button key={s} onClick={() => onUpdate({ side: s })}
                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                  duct.side === s
                    ? s === 'supply'
                      ? 'border-blue-500/50 bg-blue-500/15 text-blue-400'
                      : 'border-red-500/50 bg-red-500/15 text-red-400'
                    : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300'
                }`}>
                {DUCT_SIDE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Role */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Role</label>
          <select value={duct.role} onChange={e => onUpdate({ role: e.target.value as DuctRole })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors">
            {(Object.keys(DUCT_ROLE_LABELS) as DuctRole[]).map(r => (
              <option key={r} value={r}>{DUCT_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>

        {/* Shape */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Shape</label>
          <div className="flex gap-1">
            {(['round', 'rectangular', 'oval'] as DuctShape[]).map((s) => (
              <button key={s} onClick={() => onUpdate({ shape: s })}
                className={`flex-1 px-2 py-2 rounded-lg border text-[10px] font-semibold transition-all ${
                  duct.shape === s
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                    : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300'
                }`}>
                {DUCT_SHAPE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Dimensions */}
        {duct.shape === 'round' ? (
          <div className="mb-4">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Diameter (in)</label>
            <select value={duct.diameterIn ?? 12} onChange={e => onUpdate({ diameterIn: parseFloat(e.target.value) })}
              className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors">
              {[4,5,6,7,8,9,10,12,14,16,18,20,22,24,26,28,30,32,34,36].map(d => (
                <option key={d} value={d}>{d}"</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex gap-2 mb-4">
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Width (in)</label>
              <input type="number" value={localWidth} onChange={e => setLocalWidth(e.target.value)}
                onBlur={() => { const v = parseFloat(localWidth); if (!isNaN(v) && v > 0) onUpdate({ widthIn: v }); }}
                className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Height (in)</label>
              <input type="number" value={localHeight} onChange={e => setLocalHeight(e.target.value)}
                onBlur={() => { const v = parseFloat(localHeight); if (!isNaN(v) && v > 0) onUpdate({ heightIn: v }); }}
                className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
            </div>
          </div>
        )}

        {/* Material */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Material</label>
          <select value={duct.material} onChange={e => onUpdate({ material: e.target.value as DuctMaterial })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors">
            {(Object.keys(DUCT_MATERIAL_LABELS) as DuctMaterial[]).map(m => (
              <option key={m} value={m}>{DUCT_MATERIAL_LABELS[m]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Airflow */}
      <div className="pt-4 border-t border-slate-800">
        <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Wind className="w-3 h-3" /> Airflow
        </h4>
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">CFM</label>
          <input type="number" value={localCfm} onChange={e => setLocalCfm(e.target.value)}
            onBlur={() => { const v = parseFloat(localCfm); if (!isNaN(v) && v >= 0) onUpdate({ cfm: v }); }}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
        </div>
        <PropertyField label="Velocity" value={duct.velocityFpm ? `${duct.velocityFpm.toFixed(0)} fpm` : '—'} isReadOnly />
        <PropertyField label="Friction Rate" value={duct.frictionRateInwg100 ? `${duct.frictionRateInwg100.toFixed(4)} in.wg/100ft` : '—'} isReadOnly />
        <PropertyField label="Pressure Drop" value={duct.pressureDropInwg ? `${duct.pressureDropInwg.toFixed(4)} in.wg` : '—'} isReadOnly />
      </div>

      <div className="pt-4 border-t border-slate-800">
        <PropertyField label="ID" value={duct.id.slice(0, 20) + '…'} isReadOnly />
      </div>
    </div>
  );
}

// ── Duct fitting panel ─────────────────────────────────────────────────────
function DuctFittingPanel({ fitting, onUpdate }: { fitting: DuctFitting; onUpdate: (patch: Partial<DuctFitting>) => void }) {
  const [localEquivLen, setLocalEquivLen] = useState(fitting.equivLengthFt.toString());

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Diamond className="w-3 h-3" /> Duct Fitting
        </h4>

        {/* Type */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Fitting Type</label>
          <select value={fitting.type} onChange={e => onUpdate({ type: e.target.value as FittingType })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors">
            {(Object.keys(FITTING_TYPE_LABELS) as FittingType[]).map(t => (
              <option key={t} value={t}>{FITTING_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {/* Shape */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Shape</label>
          <div className="flex gap-1">
            {(['round', 'rectangular'] as DuctShape[]).map((s) => (
              <button key={s} onClick={() => onUpdate({ shape: s })}
                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                  fitting.shape === s
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                    : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300'
                }`}>
                {DUCT_SHAPE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Diameter */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Diameter (in)</label>
          <select value={fitting.diameterIn ?? 12} onChange={e => onUpdate({ diameterIn: parseFloat(e.target.value) })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors">
            {[4,5,6,7,8,9,10,12,14,16,18,20,22,24,26,28,30,32,34,36].map(d => (
              <option key={d} value={d}>{d}"</option>
            ))}
          </select>
        </div>

        {/* Equivalent Length */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Equivalent Length (ft)</label>
          <input type="number" value={localEquivLen} onChange={e => setLocalEquivLen(e.target.value)}
            onBlur={() => { const v = parseFloat(localEquivLen); if (!isNaN(v) && v >= 0) onUpdate({ equivLengthFt: v }); }}
            step="1"
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
        </div>

        <PropertyField label="Pressure Drop" value={fitting.pressureDropInwg ? `${fitting.pressureDropInwg.toFixed(4)} in.wg` : '—'} isReadOnly />
        <PropertyField label="Position" value={`(${fitting.x.toFixed(0)}, ${fitting.y.toFixed(0)})`} isReadOnly />
        <PropertyField label="Rotation" value={`${fitting.rotation}°`} isReadOnly />
      </div>

      <div className="pt-4 border-t border-slate-800">
        <PropertyField label="ID" value={fitting.id.slice(0, 20) + '…'} isReadOnly />
      </div>
    </div>
  );
}

// ── Room summary panel ───────────────────────────────────────────────────────
function RoomSummaryPanel({ rooms }: { rooms: DetectedRoom[] }) {
  const totalArea = rooms.reduce((s, r) => s + r.areaSqFt, 0);
  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <ScanLine className="w-3 h-3" /> Detected Rooms ({rooms.length})
        </h4>
        <PropertyField label="Total Area" value={fmtArea(totalArea)} isReadOnly />
        <div className="space-y-2 mt-4">
          {rooms.map(room => (
            <div key={room.id} className="flex items-center justify-between bg-slate-950/50 rounded-lg px-3 py-2 border border-slate-800">
              <div>
                <span className="text-sm text-slate-200 font-medium">{room.name}</span>
                <span className="text-xs text-slate-500 ml-2">{fmtArea(room.areaSqFt)}</span>
              </div>
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: room.color.replace('40', 'ff') }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Underlay panel ──────────────────────────────────────────────────────────
function UnderlayPanel({ underlay, onUpdate, onDelete }: {
  underlay: UnderlayImage;
  onUpdate: (patch: Partial<UnderlayImage>) => void;
  onDelete: () => void;
}) {
  const [localWidth, setLocalWidth] = useState(underlay.width.toFixed(0));
  const [localHeight, setLocalHeight] = useState(underlay.height.toFixed(0));
  const [localRotation, setLocalRotation] = useState(underlay.rotation.toString());
  const [aspectLocked, setAspectLocked] = useState(true);
  const aspectRatio = underlay.width / underlay.height;

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <ImageIcon className="w-3 h-3" /> Underlay Image
        </h4>
        <PropertyField label="Filename" value={underlay.name} isReadOnly />

        {/* Width / Height with aspect lock */}
        <div className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Width (px)</label>
            <input
              type="number"
              value={localWidth}
              onChange={e => {
                setLocalWidth(e.target.value);
                if (aspectLocked) {
                  const w = parseFloat(e.target.value);
                  if (!isNaN(w) && w > 0) {
                    setLocalHeight((w / aspectRatio).toFixed(0));
                  }
                }
              }}
              onBlur={() => {
                const w = parseFloat(localWidth);
                if (!isNaN(w) && w > 0) {
                  const patch: Partial<UnderlayImage> = { width: w };
                  if (aspectLocked) patch.height = w / aspectRatio;
                  onUpdate(patch);
                }
              }}
              className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
            />
          </div>
          <button
            onClick={() => setAspectLocked(!aspectLocked)}
            className={`p-2.5 rounded-lg border transition-colors mb-0 ${aspectLocked ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-500 bg-slate-950/80'}`}
            title={aspectLocked ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
          >
            {aspectLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Height (px)</label>
            <input
              type="number"
              value={localHeight}
              onChange={e => {
                setLocalHeight(e.target.value);
                if (aspectLocked) {
                  const h = parseFloat(e.target.value);
                  if (!isNaN(h) && h > 0) {
                    setLocalWidth((h * aspectRatio).toFixed(0));
                  }
                }
              }}
              onBlur={() => {
                const h = parseFloat(localHeight);
                if (!isNaN(h) && h > 0) {
                  const patch: Partial<UnderlayImage> = { height: h };
                  if (aspectLocked) patch.width = h * aspectRatio;
                  onUpdate(patch);
                }
              }}
              className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
            />
          </div>
        </div>

        {/* Rotation */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Rotation (deg)</label>
          <input
            type="number"
            value={localRotation}
            onChange={e => setLocalRotation(e.target.value)}
            onBlur={() => {
              const v = parseFloat(localRotation);
              if (!isNaN(v)) onUpdate({ rotation: v % 360 });
            }}
            step="1"
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
          />
        </div>

        {/* Opacity */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
            Opacity ({Math.round(underlay.opacity * 100)}%)
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={underlay.opacity}
            onChange={e => onUpdate({ opacity: parseFloat(e.target.value) })}
            className="w-full accent-emerald-500"
          />
        </div>
      </div>

      {/* Delete */}
      <div className="pt-4 border-t border-slate-800">
        <button
          onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors text-sm font-medium"
        >
          <Trash2 className="w-4 h-4" />
          Delete Underlay
        </button>
      </div>

      <div className="pt-4 border-t border-slate-800">
        <PropertyField label="ID" value={underlay.id.slice(0, 20) + '...'} isReadOnly />
      </div>
    </div>
  );
}

// ── Annotation / Label panel ────────────────────────────────────────────────
const FONT_FAMILIES = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'monospace'];
const COLOR_SWATCHES = [
  { label: 'White', value: '#e2e8f0' },
  { label: 'Emerald', value: '#34d399' },
  { label: 'Amber', value: '#fbbf24' },
  { label: 'Sky', value: '#38bdf8' },
  { label: 'Red', value: '#f87171' },
  { label: 'Slate', value: '#94a3b8' },
];

function AnnotationPanel({ annotation, onUpdate }: { annotation: Annotation; onUpdate: (patch: Partial<Annotation>) => void }) {
  const [localText, setLocalText] = useState(annotation.text);
  const [localFontSize, setLocalFontSize] = useState((annotation.fontSize ?? 14).toString());
  const [localRotation, setLocalRotation] = useState((annotation.rotation ?? 0).toString());
  const [localScaleX, setLocalScaleX] = useState((annotation.scaleX ?? 1).toString());
  const [localScaleY, setLocalScaleY] = useState((annotation.scaleY ?? 1).toString());

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      {/* Text */}
      <div>
        <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Type className="w-3 h-3" /> Label Properties
        </h4>
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Text</label>
          <textarea
            value={localText}
            onChange={e => setLocalText(e.target.value)}
            onBlur={() => onUpdate({ text: localText })}
            rows={2}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner resize-none"
          />
        </div>

        {/* Font Family */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Font Family</label>
          <select
            value={annotation.fontFamily ?? 'sans-serif'}
            onChange={e => onUpdate({ fontFamily: e.target.value })}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner appearance-none cursor-pointer"
          >
            <option value="sans-serif" className="bg-slate-900">Sans-serif (default)</option>
            {FONT_FAMILIES.map(f => (
              <option key={f} value={f} className="bg-slate-900">{f}</option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Font Size (px)</label>
          <input
            type="number"
            value={localFontSize}
            onChange={e => setLocalFontSize(e.target.value)}
            onBlur={() => { const v = parseInt(localFontSize); if (!isNaN(v) && v >= 8 && v <= 72) onUpdate({ fontSize: v }); }}
            min="8" max="72" step="1"
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
          />
        </div>

        {/* Color Swatches */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Color</label>
          <div className="flex gap-1.5 mb-2">
            {COLOR_SWATCHES.map(swatch => {
              const isActive = (annotation.fontColor ?? '#e2e8f0') === swatch.value;
              return (
                <button
                  key={swatch.value}
                  onClick={() => onUpdate({ fontColor: swatch.value })}
                  className={`w-7 h-7 rounded-lg border-2 transition-all ${isActive ? 'border-white scale-110' : 'border-slate-700 hover:border-slate-500'}`}
                  style={{ backgroundColor: swatch.value }}
                  title={swatch.label}
                />
              );
            })}
          </div>
          <input
            type="color"
            value={annotation.fontColor ?? '#e2e8f0'}
            onChange={e => onUpdate({ fontColor: e.target.value })}
            className="w-full h-8 rounded-lg bg-slate-950/80 border border-slate-700 cursor-pointer"
          />
        </div>

        {/* Bold / Italic */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Style</label>
          <div className="flex gap-1">
            <button
              onClick={() => onUpdate({ fontWeight: annotation.fontWeight === 'bold' ? 'normal' : 'bold' })}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                annotation.fontWeight === 'bold'
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                  : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              <Bold className="w-3.5 h-3.5" /> Bold
            </button>
            <button
              onClick={() => onUpdate({ fontStyle: annotation.fontStyle === 'italic' ? 'normal' : 'italic' })}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                annotation.fontStyle === 'italic'
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                  : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              <Italic className="w-3.5 h-3.5" /> Italic
            </button>
          </div>
        </div>

        {/* Text Align */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Text Align</label>
          <div className="flex gap-1">
            {([
              { val: 'left' as const, Icon: AlignLeft },
              { val: 'center' as const, Icon: AlignCenter },
              { val: 'right' as const, Icon: AlignRight },
            ]).map(({ val, Icon }) => {
              const isActive = (annotation.textAlign ?? 'left') === val;
              return (
                <button
                  key={val}
                  onClick={() => onUpdate({ textAlign: val })}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                    isActive
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                      : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Background Color */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Background Color</label>
          <div className="flex gap-1.5 items-center">
            <button
              onClick={() => onUpdate({ backgroundColor: undefined })}
              className={`px-3 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${
                !annotation.backgroundColor
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                  : 'border-slate-700 bg-slate-950/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              None
            </button>
            <input
              type="color"
              value={annotation.backgroundColor ?? '#1e293b'}
              onChange={e => onUpdate({ backgroundColor: e.target.value })}
              className="w-8 h-8 rounded-lg bg-slate-950/80 border border-slate-700 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Scale & Rotation */}
      <div className="pt-4 border-t border-slate-800">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Ruler className="w-3 h-3" /> Transform
        </h4>
        <div className="flex gap-2 mb-4">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Scale X</label>
            <input type="number" value={localScaleX} step="0.1" min="0.1" max="10"
              onChange={e => setLocalScaleX(e.target.value)}
              onBlur={() => { const v = parseFloat(localScaleX); if (!isNaN(v) && v > 0) onUpdate({ scaleX: v }); }}
              className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Scale Y</label>
            <input type="number" value={localScaleY} step="0.1" min="0.1" max="10"
              onChange={e => setLocalScaleY(e.target.value)}
              onBlur={() => { const v = parseFloat(localScaleY); if (!isNaN(v) && v > 0) onUpdate({ scaleY: v }); }}
              className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Rotation (deg)</label>
          <input type="number" value={localRotation}
            onChange={e => setLocalRotation(e.target.value)}
            onBlur={() => { const v = parseFloat(localRotation); if (!isNaN(v)) onUpdate({ rotation: v % 360 }); }}
            step="1"
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner"
          />
        </div>
      </div>

      <div className="pt-4 border-t border-slate-800">
        <PropertyField label="ID" value={annotation.id.slice(0, 20) + '...'} isReadOnly />
      </div>
    </div>
  );
}

// ── Shared field component ───────────────────────────────────────────────────
function PropertyField({
  label,
  value,
  isReadOnly = false,
}: {
  label: string;
  value: string;
  isReadOnly?: boolean;
}) {
  return (
    <div className="mb-4">
      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
        {label}
      </label>
      <input
        type="text"
        defaultValue={value}
        readOnly={isReadOnly}
        className={`w-full bg-slate-950/80 border ${
          isReadOnly
            ? 'border-slate-800 text-slate-400 cursor-not-allowed'
            : 'border-slate-700 text-slate-200 focus:border-emerald-500/50'
        } rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner`}
      />
    </div>
  );
}

// ── Appearance / Accessibility Panel ──────────────────────────────────────────

const BG_PRESETS = [
  { label: 'Dark Slate', value: '#0f172a' },
  { label: 'True Black', value: '#000000' },
  { label: 'Dark Gray', value: '#1a1a1a' },
  { label: 'Navy', value: '#0a1628' },
  { label: 'Warm Dark', value: '#1c1917' },
  { label: 'White', value: '#f8fafc' },
  { label: 'Light Gray', value: '#e2e8f0' },
  { label: 'Blueprint', value: '#0c1a3a' },
];

const WALL_COLOR_PRESETS = [
  { label: 'Emerald', value: '#34d399' },
  { label: 'White', value: '#f1f5f9' },
  { label: 'Stainless Steel', value: '#b0b8c4' },
  { label: 'Copper', value: '#b87333' },
  { label: 'Bronze', value: '#cd7f32' },
  { label: 'Titanium', value: '#878681' },
  { label: 'Bomb Pop Red', value: '#e63946' },
  { label: 'Bomb Pop Blue', value: '#1d3557' },
];

function AppearancePanel() {
  const canvasBgColor = useCadStore(s => s.canvasBgColor);
  const wallColor = useCadStore(s => s.wallColor);
  const openingColor = useCadStore(s => s.openingColor);
  const { setCanvasBgColor, setWallColor, setOpeningColor, markDirty } = useCadStore();

  const applyBg = (color: string) => {
    setCanvasBgColor(color);
    const canvas = useCadStore.getState().canvas;
    if (canvas) {
      canvas.backgroundColor = color;
      canvas.requestRenderAll();
    }
    markDirty();
  };

  const applyWallColor = (color: string) => {
    setWallColor(color);
    markDirty();
  };

  const applyOpeningColor = (color: string) => {
    setOpeningColor(color);
    markDirty();
  };

  return (
    <div className="border-t border-slate-800/50 pt-4">
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Settings2 className="w-3 h-3" /> Appearance
      </h4>

      {/* Canvas Background */}
      <div className="mb-4">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-2">Canvas Background</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {BG_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => applyBg(p.value)}
              className={`w-7 h-7 rounded-lg border-2 transition-all ${canvasBgColor === p.value ? 'border-emerald-400 scale-110' : 'border-slate-700 hover:border-slate-500'}`}
              style={{ backgroundColor: p.value }}
              title={p.label}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" value={canvasBgColor} onChange={e => applyBg(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer bg-transparent border-0" />
          <span className="text-xs text-slate-500 font-mono">{canvasBgColor}</span>
        </div>
      </div>

      {/* Wall Color */}
      <div className="mb-4">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-2">Wall Color</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {WALL_COLOR_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => applyWallColor(p.value)}
              className={`w-7 h-7 rounded-lg border-2 transition-all ${wallColor === p.value ? 'border-emerald-400 scale-110' : 'border-slate-700 hover:border-slate-500'}`}
              style={{ backgroundColor: p.value }}
              title={p.label}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" value={wallColor} onChange={e => applyWallColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer bg-transparent border-0" />
          <span className="text-xs text-slate-500 font-mono">{wallColor}</span>
        </div>
      </div>

      {/* Opening Color */}
      <div className="mb-4">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-2">Window / Door Color</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {WALL_COLOR_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => applyOpeningColor(p.value)}
              className={`w-7 h-7 rounded-lg border-2 transition-all ${openingColor === p.value ? 'border-emerald-400 scale-110' : 'border-slate-700 hover:border-slate-500'}`}
              style={{ backgroundColor: p.value }}
              title={p.label}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" value={openingColor} onChange={e => applyOpeningColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer bg-transparent border-0" />
          <span className="text-xs text-slate-500 font-mono">{openingColor}</span>
        </div>
      </div>

    </div>
  );
}
