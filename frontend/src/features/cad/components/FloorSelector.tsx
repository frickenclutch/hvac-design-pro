import React, { useState, useRef, useEffect } from 'react';
import { Plus, Eye, EyeOff, Lock, Unlock, Trash2, Layers } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';

export default function FloorSelector() {
  const { floors, activeFloorId, setActiveFloor, addFloor, updateFloor, removeFloor } = useCadStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-slate-900/70 border border-slate-700/50 shadow-[0_5px_30px_rgba(0,0,0,0.6)] backdrop-blur-xl">

        {/* Layers icon */}
        <div className="flex items-center gap-1.5 px-2 py-1 text-slate-500">
          <Layers className="w-3.5 h-3.5" />
          <span className="text-[10px] font-mono uppercase tracking-widest">Floors</span>
        </div>

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
                {floor.height != null && (
                  <span className={`text-[10px] font-mono ${isActive ? 'text-emerald-400/60' : 'text-slate-500'}`}>
                    {floor.height} ft
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
                      updateFloor(floor.id, { visible: !floor.visible });
                    }}
                    className={`p-0.5 rounded transition-colors ${
                      floor.visible === false
                        ? 'text-amber-400/70 hover:text-amber-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    aria-label={floor.visible === false ? 'Show floor' : 'Hide floor'}
                  >
                    {floor.visible === false ? (
                      <EyeOff className="w-3 h-3" />
                    ) : (
                      <Eye className="w-3 h-3" />
                    )}
                  </button>

                  {/* Lock toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateFloor(floor.id, { locked: !floor.locked });
                    }}
                    className={`p-0.5 rounded transition-colors ${
                      floor.locked
                        ? 'text-rose-400/70 hover:text-rose-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    aria-label={floor.locked ? 'Unlock floor' : 'Lock floor'}
                  >
                    {floor.locked ? (
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
