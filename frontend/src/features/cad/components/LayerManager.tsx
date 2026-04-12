import { useState, useCallback } from 'react';
import { useCadStore } from '../store/useCadStore';
import { Eye, EyeOff, Lock, Unlock, Layers, Target, Circle, CheckCircle2 } from 'lucide-react';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
import PanelResizeHandle from './PanelResizeHandle';

export default function LayerManager() {
  const [open, setOpen] = useState(true);

  const {
    layers,
    activeLayerId,
    setActiveLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    setLayerOpacity,
    soloLayer
  } = useCadStore();

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

  const panelWidth = usePreferencesStore(s => s.panelSizes.layersWidth);
  const updatePrefs = usePreferencesStore(s => s.update);
  const handleResize = useCallback((w: number) => {
    updatePrefs({ panelSizes: { ...usePreferencesStore.getState().panelSizes, layersWidth: w } });
  }, [updatePrefs]);

  // ---- Expanded panel ----
  return (
    <div className="absolute right-6 bottom-6 z-10 pointer-events-auto" style={{ width: panelWidth }}>
      <div className="glass-panel rounded-2xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/70 overflow-hidden transition-[background,border,shadow] duration-500 relative">
        <PanelResizeHandle edge="left" currentWidth={panelWidth} onResize={handleResize} minWidth={220} maxWidth={520} />

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
          {layers.map((layer) => {
            const isActive = activeLayerId === layer.id;
            
            return (
              <li
                key={layer.id}
                className={`group flex items-center gap-2 px-3 py-2.5 transition-colors ${
                  layer.visible ? 'hover:bg-slate-800/40' : 'opacity-40'
                } ${isActive ? 'bg-emerald-500/5 border-l-2 border-emerald-500' : 'border-l-2 border-transparent'}`}
              >
                {/* Active Layer Toggle */}
                <button
                  onClick={() => setActiveLayer(layer.id)}
                  className={`p-1 transition-colors ${isActive ? 'text-emerald-400' : 'text-slate-600 hover:text-slate-400'}`}
                  title={isActive ? 'Active drawing layer' : 'Set as active drawing layer'}
                >
                  {isActive ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                </button>

                {/* Color dot */}
                <span
                  className="w-2 h-2 rounded-full shrink-0 ring-1 ring-white/10"
                  style={{ backgroundColor: layer.color }}
                />

                {/* Name */}
                <span 
                  className={`flex-1 text-xs font-medium truncate select-none cursor-pointer ${isActive ? 'text-emerald-50' : 'text-slate-400'}`}
                  onClick={() => setActiveLayer(layer.id)}
                >
                  {layer.name}
                </span>

                {/* Opacity slider */}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={layer.opacity}
                  onChange={(e) => setLayerOpacity(layer.id, parseFloat(e.target.value))}
                  className="w-12 h-1 accent-emerald-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
                />

                {/* Solo toggle */}
                <button
                  onClick={() => soloLayer(layer.id)}
                  className="p-1 rounded hover:bg-slate-700/50 transition-colors opacity-0 group-hover:opacity-100"
                  title="Solo this layer"
                >
                  <Target className="w-3.5 h-3.5 text-blue-400" />
                </button>

                {/* Visibility toggle */}
                <button
                  onClick={(e) => {
                    if (e.altKey) {
                      soloLayer(layer.id);
                    } else {
                      toggleLayerVisibility(layer.id);
                    }
                  }}
                  className="p-1 rounded hover:bg-slate-700/50 transition-colors"
                  title={layer.visible ? 'Hide layer (Alt+Click to Solo)' : 'Show layer'}
                >
                  {layer.visible ? (
                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                  )}
                </button>

                {/* Lock toggle */}
                <button
                  onClick={() => toggleLayerLock(layer.id)}
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
            );
          })}
        </ul>
      </div>
    </div>
  );
}
