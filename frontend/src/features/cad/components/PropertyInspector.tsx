import { useState, useMemo } from 'react';
import { useCadStore } from '../store/useCadStore';
import type { WallMaterial, Opening, HvacUnit, DetectedRoom } from '../store/useCadStore';
import { Settings2, Layers, Cpu, Ruler, Triangle, Wind, DoorOpen, LayoutGrid, ScanLine } from 'lucide-react';

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
  const { selectedObject, selectedWallId, walls, updateWall, updateOpening, updateHvacUnit, floors, activeFloorId } = useCadStore();

  const floor = floors.find(f => f.id === activeFloorId);

  // Find the selected wall if one is active
  const selectedWall = selectedWallId ? walls.find((w) => w.id === selectedWallId) ?? null : null;

  // Detect selected opening or HVAC unit from fabric object name
  const selectedOpening = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = (selectedObject as any).name as string | undefined;
    if (!name?.startsWith('opening-')) return null;
    const id = name.replace('opening-', '');
    return floor.openings.find(o => o.id === id) ?? null;
  }, [selectedObject, floor]);

  const selectedHvac = useMemo(() => {
    if (!selectedObject || !floor) return null;
    const name = (selectedObject as any).name as string | undefined;
    if (!name?.startsWith('hvac-')) return null;
    const id = name.replace('hvac-', '');
    return floor.hvacUnits.find(u => u.id === id) ?? null;
  }, [selectedObject, floor]);

  const headerText = selectedWall ? 'Wall Selected' : selectedOpening ? 'Opening Selected' : selectedHvac ? 'HVAC Unit Selected' : selectedObject ? 'Object Selected' : 'Canvas Settings';

  return (
    <div className="absolute right-6 top-24 bottom-6 w-80 z-10 pointer-events-none">
      <div className="h-full glass-panel rounded-2xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/70 overflow-hidden pointer-events-auto transition-all duration-500 transform origin-right">

        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2 mb-1">
            <Settings2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">Properties</h3>
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

          ) : floor && floor.rooms.length > 0 && !selectedObject ? (
            <RoomSummaryPanel rooms={floor.rooms} />

          ) : !selectedObject ? (
            /* ── DEFAULT (no selection) ── */
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500 fade-in">
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Layers className="w-3 h-3" /> Project Defaults
                </h4>
                <PropertyField label="Default Ceiling Height" value="9 ft" />
                <PropertyField label="Zone Type" value="Conditioned Space" />
                <PropertyField label="Design Temp (Cooling)" value="75 °F" />
                <PropertyField label="Design Temp (Heating)" value="70 °F" />
              </div>
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
        <PropertyField label="Length" value={`${lengthFt} ft`} isReadOnly />
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">
            Thickness (in)
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

// ── Opening panel ────────────────────────────────────────────────────────────
function OpeningPanel({ opening, onUpdate }: { opening: Opening; onUpdate: (patch: Partial<Opening>) => void }) {
  const isWindow = opening.type === 'window';
  const [localWidth, setLocalWidth] = useState(opening.widthIn.toString());
  const [localHeight, setLocalHeight] = useState(opening.heightIn.toString());

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          {isWindow ? <LayoutGrid className="w-3 h-3" /> : <DoorOpen className="w-3 h-3" />}
          {isWindow ? 'Window' : 'Door'} Properties
        </h4>
        <PropertyField label="Type" value={opening.type.replace('_', ' ')} isReadOnly />
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Width (in)</label>
          <input type="number" value={localWidth} onChange={e => setLocalWidth(e.target.value)}
            onBlur={() => { const v = parseFloat(localWidth); if (!isNaN(v) && v > 0) onUpdate({ widthIn: v }); }}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
        </div>
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Height (in)</label>
          <input type="number" value={localHeight} onChange={e => setLocalHeight(e.target.value)}
            onBlur={() => { const v = parseFloat(localHeight); if (!isNaN(v) && v > 0) onUpdate({ heightIn: v }); }}
            className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 focus:border-emerald-500/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors shadow-inner" />
        </div>
        <PropertyField label="Position" value={`${(opening.positionAlongWall * 100).toFixed(0)}% along wall`} isReadOnly />
      </div>

      {isWindow && (
        <div className="pt-4 border-t border-slate-800">
          <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Triangle className="w-3 h-3" /> Thermal
          </h4>
          <PropertyField label="U-Factor" value={opening.uFactor?.toFixed(3) ?? '—'} isReadOnly />
          <PropertyField label="SHGC" value={opening.shgc?.toFixed(2) ?? '—'} isReadOnly />
        </div>
      )}

      {!isWindow && opening.swingDirection && (
        <div className="pt-4 border-t border-slate-800">
          <PropertyField label="Swing" value={opening.swingDirection} isReadOnly />
        </div>
      )}

      <div className="pt-4 border-t border-slate-800">
        <PropertyField label="ID" value={opening.id.slice(0, 20) + '…'} isReadOnly />
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

// ── Room summary panel ───────────────────────────────────────────────────────
function RoomSummaryPanel({ rooms }: { rooms: DetectedRoom[] }) {
  const totalArea = rooms.reduce((s, r) => s + r.areaSqFt, 0);
  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 fade-in">
      <div>
        <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <ScanLine className="w-3 h-3" /> Detected Rooms ({rooms.length})
        </h4>
        <PropertyField label="Total Area" value={`${totalArea.toFixed(0)} sq ft`} isReadOnly />
        <div className="space-y-2 mt-4">
          {rooms.map(room => (
            <div key={room.id} className="flex items-center justify-between bg-slate-950/50 rounded-lg px-3 py-2 border border-slate-800">
              <div>
                <span className="text-sm text-slate-200 font-medium">{room.name}</span>
                <span className="text-xs text-slate-500 ml-2">{room.areaSqFt.toFixed(0)} sq ft</span>
              </div>
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: room.color.replace('40', 'ff') }} />
            </div>
          ))}
        </div>
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
