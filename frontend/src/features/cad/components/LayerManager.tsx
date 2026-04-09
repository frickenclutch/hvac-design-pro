import { useState } from 'react';
import { useCadStore } from '../store/useCadStore';
import { Eye, EyeOff, Lock, Unlock, Layers } from 'lucide-react';

/** Layer shape consumed by this panel. */
export interface Layer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

/**
 * Default layers used until the store exposes its own `layers` slice.
 * Once `useCadStore` gains `layers`, `toggleLayerVisibility`, and
 * `toggleLayerLock`, swap the local state for store selectors.
 */
const DEFAULT_LAYERS: Layer[] = [
  { id: 'walls',       name: 'Walls',       color: '#10b981', visible: true, locked: false, opacity: 1 },
  { id: 'openings',    name: 'Openings',    color: '#3b82f6', visible: true, locked: false, opacity: 1 },
  { id: 'hvac',        name: 'HVAC',        color: '#f59e0b', visible: true, locked: false, opacity: 1 },
  { id: 'annotations', name: 'Annotations', color: '#a855f7', visible: true, locked: false, opacity: 0.8 },
  { id: 'underlay',    name: 'Underlay',    color: '#64748b', visible: true, locked: true,  opacity: 0.35 },
];

export default function LayerManager() {
  const [open, setOpen] = useState(true);

  // --- Store-backed layer state (falls back to local until store is wired) ---
  const storeLayers           = useCadStore((s) => (s as any).layers as Layer[] | undefined);
  const storeToggleVisibility = useCadStore((s) => (s as any).toggleLayerVisibility as ((id: string) => void) | undefined);
  const storeToggleLock       = useCadStore((s) => (s as any).toggleLayerLock as ((id: string) => void) | undefined);

  const [localLayers, setLocalLayers] = useState<Layer[]>(DEFAULT_LAYERS);

  const layers = storeLayers ?? localLayers;

  const toggleVisibility = (id: string) => {
    if (storeToggleVisibility) {
      storeToggleVisibility(id);
    } else {
      setLocalLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
      );
    }
  };

  const toggleLock = (id: string) => {
    if (storeToggleLock) {
      storeToggleLock(id);
    } else {
      setLocalLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)),
      );
    }
  };

  const setOpacity = (id: string, opacity: number) => {
    setLocalLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, opacity } : l)),
    );
  };

  // ---- Collapsed toggle button ----
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-6 bottom-20 z-[55] glass-panel rounded-xl p-3 border border-slate-700/50 backdrop-blur-xl bg-slate-900/70 shadow-[0_0_30px_rgba(0,0,0,0.5)] hover:border-emerald-500/40 transition-colors pointer-events-auto"
        title="Show Layers"
      >
        <Layers className="w-5 h-5 text-emerald-400" />
      </button>
    );
  }

  // ---- Expanded panel ----
  return (
    <div className="absolute right-6 bottom-6 w-72 z-10 pointer-events-auto">
      <div className="glass-panel rounded-2xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/70 overflow-hidden transition-all duration-500">

        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">
              Layers
            </h3>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-slate-500 hover:text-slate-300 transition-colors text-xs"
            title="Collapse"
          >
            &times;
          </button>
        </div>

        {/* Layer list */}
        <ul className="flex flex-col divide-y divide-slate-800/60">
          {layers.map((layer) => (
            <li
              key={layer.id}
              className={`group flex items-center gap-2.5 px-4 py-2.5 transition-colors ${
                layer.visible ? 'hover:bg-slate-800/40' : 'opacity-40'
              }`}
            >
              {/* Color dot */}
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
                style={{ backgroundColor: layer.color }}
              />

              {/* Name */}
              <span className="flex-1 text-sm text-slate-300 font-medium truncate select-none">
                {layer.name}
              </span>

              {/* Opacity slider */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layer.opacity}
                onChange={(e) => setOpacity(layer.id, parseFloat(e.target.value))}
                className="w-14 h-1 accent-emerald-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
              />

              {/* Visibility toggle */}
              <button
                onClick={() => toggleVisibility(layer.id)}
                className="p-1 rounded hover:bg-slate-700/50 transition-colors"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? (
                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                )}
              </button>

              {/* Lock toggle */}
              <button
                onClick={() => toggleLock(layer.id)}
                className="p-1 rounded hover:bg-slate-700/50 transition-colors"
                title={layer.locked ? 'Unlock layer' : 'Lock layer'}
              >
                {layer.locked ? (
                  <Lock className="w-3.5 h-3.5 text-amber-500/80" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
