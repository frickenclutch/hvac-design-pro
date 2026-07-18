import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Eye, EyeOff, Lock, Unlock, Trash2, Layers, ChevronUp, ChevronDown, Layout, GripVertical } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';
import { fmtLength } from '../../../utils/units';

/** Minimum px from any viewport edge when dragging */
const EDGE_MARGIN = 8;

export default function FloorSelector() {
  const { 
    floors, 
    activeFloorId, 
    setActiveFloor, 
    addFloor, 
    updateFloor, 
    removeFloor, 
    panelFloors, 
    setPanelFloors,
    ghostingEnabled,
    setGhostingEnabled
  } = useCadStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Floating position (same mechanism as the Toolbox) ───────────────────
  // null = docked at the default top-center spot. Once dragged, the bar
  // becomes a fixed-position island and the spot persists in preferences.
  const savedPos = usePreferencesStore(s => s.panelSizes.floorsPos ?? null);
  const updatePrefs = usePreferencesStore(s => s.update);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(savedPos);

  // Clamp a saved position to the current viewport on mount so the bar is
  // always reachable after a resize or monitor change.
  useEffect(() => {
    if (!pos || !panelRef.current) return;
    const r = panelRef.current.getBoundingClientRect();
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - r.width - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - r.height - EDGE_MARGIN);
    const nx = Math.max(EDGE_MARGIN, Math.min(maxX, pos.x));
    const ny = Math.max(EDGE_MARGIN, Math.min(maxY, pos.y));
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
  // Latest dragged position — read by onUp so persisting prefs happens as a
  // plain event-handler call, never inside a setState updater (React forbids
  // updating another component's store mid-render).
  const posRef = useRef(pos);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    // Don't initiate drag from interactive children (buttons, inputs)
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    e.preventDefault();
    e.stopPropagation();
    // Undock: seed the position from wherever the bar currently sits
    const rect = panelRef.current?.getBoundingClientRect();
    const origin = pos ?? (rect ? { x: rect.left, y: rect.top } : { x: EDGE_MARGIN, y: 64 });
    if (!pos) setPos(origin);
    posRef.current = origin;
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: origin.x, oy: origin.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const onMove = (me: PointerEvent) => {
      if (!dragging.current) return;
      const el = panelRef.current;
      const w = el ? el.getBoundingClientRect().width : 400;
      const h = el ? el.getBoundingClientRect().height : 44;
      const maxX = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
      const maxY = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
      const next = {
        x: Math.round(Math.max(EDGE_MARGIN, Math.min(maxX, dragStart.current.ox + (me.clientX - dragStart.current.mx)))),
        y: Math.round(Math.max(EDGE_MARGIN, Math.min(maxY, dragStart.current.oy + (me.clientY - dragStart.current.my)))),
      };
      posRef.current = next;
      setPos(next);
    };

    const onUp = () => {
      dragging.current = false;
      const p = posRef.current;
      if (p) {
        const ps = usePreferencesStore.getState().panelSizes;
        updatePrefs({ panelSizes: { ...ps, floorsPos: { x: p.x, y: p.y } } });
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pos, updatePrefs]);

  const resetDock = () => {
    setPos(null);
    const ps = usePreferencesStore.getState().panelSizes;
    updatePrefs({ panelSizes: { ...ps, floorsPos: null } });
  };

  // Shared wrapper: docked top-center by default, fixed island once dragged
  const wrapperClass = pos
    ? 'fixed z-30 pointer-events-auto'
    : 'absolute top-16 left-1/2 -translate-x-1/2 z-10 pointer-events-auto';
  const wrapperStyle = pos ? { left: pos.x, top: pos.y } : undefined;

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleDoubleClick = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  };

  const commitRename = (id: string) => {
    const trimmed = editValue.trim();
    if (trimmed) {
      updateFloor(id, { name: trimmed });
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') commitRename(id);
    if (e.key === 'Escape') setEditingId(null);
  };

  if (!panelFloors) {
    return (
      <div ref={panelRef} className={wrapperClass} style={wrapperStyle}>
        <button
          onClick={() => setPanelFloors(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/70 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
          title="Show Floor Selector (F)"
        >
          <Layers className="w-3.5 h-3.5" />
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div ref={panelRef} className={wrapperClass} style={wrapperStyle}>
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-slate-900/70 border border-slate-700/50 shadow-[0_5px_30px_rgba(0,0,0,0.6)] backdrop-blur-xl">

        {/* Drag handle — move the bar anywhere; double-click to re-dock */}
        <div
          onPointerDown={onDragStart}
          onDoubleClick={resetDock}
          className="px-1 py-1.5 cursor-grab active:cursor-grabbing rounded-lg hover:bg-slate-800/50 transition-colors"
          title="Drag to move · double-click to re-dock"
        >
          <GripVertical className="w-3 h-3 text-slate-600" />
        </div>

        {/* Layers icon + collapse */}
        <button
          onClick={() => setPanelFloors(false)}
          className="flex items-center gap-1.5 px-2 py-1 text-slate-500 hover:text-slate-300 transition-colors rounded-lg hover:bg-slate-800/50"
          title="Hide Floor Selector (F)"
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="text-[10px] font-mono uppercase tracking-widest">Floors</span>
          <ChevronUp className="w-3 h-3" />
        </button>

        <div className="w-px h-5 bg-slate-700/60 mx-1" />

        {/* Floor tabs */}
        <div className="flex items-center gap-1">
          {floors.map((floor) => {
            const isActive = floor.id === activeFloorId;
            const isEditing = floor.id === editingId;

            return (
              <div
                key={floor.id}
                className={`group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-200 select-none ${
                  isActive
                    ? 'bg-emerald-500/15 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                    : 'border border-transparent hover:bg-slate-800/60 hover:border-slate-700/40'
                }`}
                onClick={() => setActiveFloor(floor.id)}
              >
                {/* Floor name */}
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitRename(floor.id)}
                    onKeyDown={(e) => handleKeyDown(e, floor.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent text-xs font-semibold text-white outline-none border-b border-emerald-400/60 w-20 py-0"
                  />
                ) : (
                  <span
                    className={`text-xs font-semibold whitespace-nowrap ${
                      isActive ? 'text-emerald-300' : 'text-slate-300 group-hover:text-slate-100'
                    }`}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleDoubleClick(floor.id, floor.name);
                    }}
                  >
                    {floor.name}
                  </span>
                )}

                {/* Floor height */}
                {floor.heightFt != null && (
                  <span className={`text-[10px] font-mono ${isActive ? 'text-emerald-400/60' : 'text-slate-500'}`}>
                    {fmtLength(floor.heightFt, 0)}
                  </span>
                )}

                {/* Action icons - shown on hover or when active */}
                <div className={`flex items-center gap-0.5 ml-0.5 transition-opacity duration-150 ${
                  isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}>
                  {/* Visibility toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateFloor(floor.id, { isVisible: !floor.isVisible });
                    }}
                    className={`p-0.5 rounded transition-colors ${
                      floor.isVisible === false
                        ? 'text-amber-400/70 hover:text-amber-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    aria-label={floor.isVisible === false ? 'Show floor' : 'Hide floor'}
                  >
                    {floor.isVisible === false ? (
                      <EyeOff className="w-3 h-3" />
                    ) : (
                      <Eye className="w-3 h-3" />
                    )}
                  </button>

                  {/* Lock toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateFloor(floor.id, { isLocked: !floor.isLocked });
                    }}
                    className={`p-0.5 rounded transition-colors ${
                      floor.isLocked
                        ? 'text-rose-400/70 hover:text-rose-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    aria-label={floor.isLocked ? 'Unlock floor' : 'Lock floor'}
                  >
                    {floor.isLocked ? (
                      <Lock className="w-3 h-3" />
                    ) : (
                      <Unlock className="w-3 h-3" />
                    )}
                  </button>

                  {/* Delete - only if more than one floor */}
                  {floors.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFloor(floor.id);
                      }}
                      className="p-0.5 rounded text-slate-500 hover:text-rose-400 transition-colors"
                      aria-label="Delete floor"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="w-px h-5 bg-slate-700/60 mx-1" />

        {/* Ghost Mode Toggle */}
        <button
          onClick={() => setGhostingEnabled(!ghostingEnabled)}
          className={`p-1.5 rounded-lg transition-all duration-200 group relative ${
            ghostingEnabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-500 hover:text-slate-300'
          }`}
          title="Toggle Ghosting (Show other floors as faded outlines)"
        >
          <Layout className="w-3.5 h-3.5" />
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 bg-slate-800/90 border border-slate-700 text-slate-200 text-[10px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
            Ghost Floors: {ghostingEnabled ? 'ON' : 'OFF'}
          </div>
        </button>

        <div className="w-px h-5 bg-slate-700/60 mx-1" />

        {/* Add floor button */}
        <button
          onClick={() => addFloor()}
          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all duration-200 group relative"
          aria-label="Add floor"
        >
          <Plus className="w-3.5 h-3.5" />
          {/* Tooltip */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 bg-slate-800/90 border border-slate-700 text-slate-200 text-[10px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
            Add Floor
          </div>
        </button>
      </div>
    </div>
  );
}
