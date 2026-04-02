import { useState } from 'react';
import { useCadStore } from '../store/useCadStore';
import type { WallMaterial } from '../store/useCadStore';
import { Settings2, Layers, Cpu, Ruler, Triangle } from 'lucide-react';

const MATERIAL_LABELS: Record<WallMaterial, string> = {
  insulated_stud: 'Insulated Wood Stud',
  cmu: 'CMU Block',
  concrete: 'Poured Concrete',
};

// Auto-compute U-Factor from R-Value
const uFactor = (r: number) => (r > 0 ? (1 / r).toFixed(4) : '—');

export default function PropertyInspector() {
  const { selectedObject, selectedWallId, walls, updateWall } = useCadStore();

  // Find the selected wall if one is active
  const selectedWall = selectedWallId ? walls.find((w) => w.id === selectedWallId) ?? null : null;

  return (
    <div className="absolute right-6 top-24 bottom-6 w-80 z-10 pointer-events-none">
      <div className="h-full glass-panel rounded-2xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/70 overflow-hidden pointer-events-auto transition-all duration-500 transform origin-right">

        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2 mb-1">
            <Settings2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">Properties</h3>
          </div>
          <p className="text-xs text-slate-500 font-mono">
            {selectedWall
              ? 'Wall Selected'
              : selectedObject
              ? 'Object Selected'
              : 'Canvas Settings'}
          </p>
        </div>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">

          {/* ── WALL SELECTED ── */}
          {selectedWall ? (
            <WallPanel
              wall={selectedWall}
              onUpdate={(patch) => updateWall(selectedWall.id, patch)}
            />
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

              <div className="pt-4 border-t border-slate-800">
                <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Cpu className="w-3 h-3" /> Material Properties
                </h4>
                <PropertyField label="R-Value" value="R-19" />
                <PropertyField label="U-Factor" value="0.05" />
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
