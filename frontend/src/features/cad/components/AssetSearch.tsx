import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useCadStore } from '../store/useCadStore';
import type { Floor } from '../store/useCadStore';
import { Search, X, Layers, DoorOpen, Wind, MessageSquare, Image, ScanLine } from 'lucide-react';
import { fmtLength, fmtSmallLength, fmtArea } from '../../../utils/units';

// ── Search Result Types ───────────────────────────────────────────────────────
interface SearchResult {
  id: string;
  type: 'wall' | 'opening' | 'hvac' | 'room' | 'annotation' | 'underlay';
  name: string;
  description: string;
  floorId: string;
  floorName: string;
  fabricId: string;
  // For centering on canvas
  x?: number;
  y?: number;
}

const TYPE_CONFIG: Record<SearchResult['type'], { color: string; label: string }> = {
  wall: { color: 'text-emerald-400', label: 'Wall' },
  opening: { color: 'text-sky-400', label: 'Opening' },
  hvac: { color: 'text-purple-400', label: 'HVAC' },
  room: { color: 'text-cyan-400', label: 'Room' },
  annotation: { color: 'text-amber-400', label: 'Label' },
  underlay: { color: 'text-slate-400', label: 'Underlay' },
};

const TypeIcon = ({ type }: { type: SearchResult['type'] }) => {
  const cls = `w-4 h-4 ${TYPE_CONFIG[type].color}`;
  switch (type) {
    case 'wall': return <Layers className={cls} />;
    case 'opening': return <DoorOpen className={cls} />;
    case 'hvac': return <Wind className={cls} />;
    case 'room': return <ScanLine className={cls} />;
    case 'annotation': return <MessageSquare className={cls} />;
    case 'underlay': return <Image className={cls} />;
  }
};

// ── Build searchable index from all floors ───────────────────────────────────
function buildIndex(floors: Floor[], pxPerFt: number): SearchResult[] {
  const results: SearchResult[] = [];

  for (const floor of floors) {
    // Walls
    for (const w of floor.walls) {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const lengthFt = (Math.sqrt(dx * dx + dy * dy) / pxPerFt).toFixed(1);
      results.push({
        id: w.id,
        type: 'wall',
        name: `Wall ${w.id.slice(-6)}`,
        description: `${w.material.replace('_', ' ')} | R-${w.rValue} | ${fmtLength(parseFloat(lengthFt))} | ${fmtSmallLength(w.thicknessIn, 0)} thick`,
        floorId: floor.id,
        floorName: floor.name,
        fabricId: w.fabricId,
        x: (w.x1 + w.x2) / 2,
        y: (w.y1 + w.y2) / 2,
      });
    }

    // Openings
    for (const o of floor.openings) {
      const wall = floor.walls.find(w => w.id === o.wallId);
      let cx: number | undefined, cy: number | undefined;
      if (wall) {
        cx = wall.x1 + o.positionAlongWall * (wall.x2 - wall.x1);
        cy = wall.y1 + o.positionAlongWall * (wall.y2 - wall.y1);
      }
      const dims = `${o.widthIn}x${o.heightIn}`;
      const extra = o.type === 'window'
        ? `U-${o.uFactor?.toFixed(2) ?? '?'} | SHGC ${o.shgc?.toFixed(2) ?? '?'}`
        : o.swingDirection ? `swing: ${o.swingDirection}` : '';
      results.push({
        id: o.id,
        type: 'opening',
        name: `${o.type.replace('_', ' ')} ${dims}`,
        description: `${dims}" | ${extra}`.trim(),
        floorId: floor.id,
        floorName: floor.name,
        fabricId: o.fabricId,
        x: cx,
        y: cy,
      });
    }

    // HVAC Units
    for (const h of floor.hvacUnits) {
      results.push({
        id: h.id,
        type: 'hvac',
        name: h.label || h.type.replace('_', ' '),
        description: `${h.type.replace('_', ' ')} | ${h.cfm ?? 0} CFM`,
        floorId: floor.id,
        floorName: floor.name,
        fabricId: h.fabricId,
        x: h.x,
        y: h.y,
      });
    }

    // Rooms
    for (const r of floor.rooms) {
      results.push({
        id: r.id,
        type: 'room',
        name: r.name,
        description: `${fmtArea(r.areaSqFt)} | ${fmtLength(r.perimeterFt, 0)} perimeter`,
        floorId: floor.id,
        floorName: floor.name,
        fabricId: `room-${r.id}`,
        x: r.centroid.x,
        y: r.centroid.y,
      });
    }

    // Annotations
    for (const a of floor.annotations) {
      results.push({
        id: a.id,
        type: 'annotation',
        name: a.text.length > 30 ? a.text.slice(0, 30) + '...' : a.text,
        description: `${a.type} annotation`,
        floorId: floor.id,
        floorName: floor.name,
        fabricId: a.fabricId,
        x: a.x,
        y: a.y,
      });
    }

    // Underlays
    for (const u of (floor.underlays ?? [])) {
      results.push({
        id: u.id,
        type: 'underlay',
        name: u.name,
        description: `${u.width.toFixed(0)} x ${u.height.toFixed(0)} px`,
        floorId: floor.id,
        floorName: floor.name,
        fabricId: `underlay-${u.id}`,
        x: u.x + u.width / 2,
        y: u.y + u.height / 2,
      });
    }
  }

  return results;
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function AssetSearch({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { floors, activeFloorId, setActiveFloor, canvas, projectScale } = useCadStore();

  const allResults = useMemo(() => buildIndex(floors, projectScale.pxPerFt), [floors, projectScale.pxPerFt]);

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allResults.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.floorName.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [query, allResults]);

  // Reset active index when results change
  useEffect(() => { setActiveIndex(0); }, [filtered]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const active = listRef.current.children[activeIndex] as HTMLElement;
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const selectResult = useCallback((result: SearchResult) => {
    // Switch floor if needed
    if (result.floorId !== activeFloorId) {
      setActiveFloor(result.floorId);
    }

    // Pan canvas to center on object
    if (canvas && result.x !== undefined && result.y !== undefined) {
      const zoom = canvas.getZoom();
      const panX = (canvas.width ?? 800) / 2 - result.x * zoom;
      const panY = (canvas.height ?? 600) / 2 - result.y * zoom;
      const vpt = canvas.viewportTransform;
      if (vpt) {
        vpt[4] = panX;
        vpt[5] = panY;
        canvas.setViewportTransform(vpt);
      }

      // Find and select the object on canvas
      setTimeout(() => {
        const c = useCadStore.getState().canvas;
        if (!c) return;
        const objects = c.getObjects();
        const target = objects.find((obj: any) => {
          const n = obj.name as string | undefined;
          if (!n) return false;
          return n === result.fabricId || n.endsWith(result.id);
        });
        if (target) {
          c.setActiveObject(target);
          useCadStore.getState().setSelectedObject(target as any);

          // Flash/pulse highlight
          const origOpacity = target.opacity ?? 1;
          let pulses = 0;
          const interval = setInterval(() => {
            target.set('opacity', pulses % 2 === 0 ? 0.3 : origOpacity);
            c.requestRenderAll();
            pulses++;
            if (pulses >= 6) {
              clearInterval(interval);
              target.set('opacity', origOpacity);
              c.requestRenderAll();
            }
          }, 120);
        }
        c.requestRenderAll();
      }, 100);
    }

    onClose();
  }, [canvas, activeFloorId, setActiveFloor, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      selectResult(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filtered, activeIndex, selectResult, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl glass-panel rounded-2xl border border-slate-700/50 backdrop-blur-xl bg-slate-900/90 shadow-[0_0_60px_rgba(0,0,0,0.7)] overflow-hidden animate-in zoom-in-95 duration-200 fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
          <Search className="w-5 h-5 text-emerald-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search walls, openings, HVAC units, rooms..."
            className="flex-1 bg-transparent text-slate-200 text-sm placeholder-slate-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 rounded border border-slate-700">
            ESC
          </kbd>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto custom-scrollbar">
          {query.trim() === '' ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              Type to search walls, openings, HVAC units, rooms, labels, and underlays across all floors.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              No results found for "{query}"
            </div>
          ) : (
            filtered.map((result, i) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => selectResult(result)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors border-b border-slate-800/50 last:border-b-0 ${
                  i === activeIndex
                    ? 'bg-emerald-500/10 border-l-2 border-l-emerald-500'
                    : 'hover:bg-slate-800/50'
                }`}
              >
                <div className="shrink-0">
                  <TypeIcon type={result.type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200 truncate">{result.name}</span>
                    <span className={`text-[10px] font-mono uppercase tracking-wider ${TYPE_CONFIG[result.type].color}`}>
                      {TYPE_CONFIG[result.type].label}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">{result.description}</div>
                </div>
                <div className="shrink-0 text-[10px] text-slate-600 font-mono">
                  {result.floorName}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        {filtered.length > 0 && (
          <div className="px-5 py-2 border-t border-slate-800 flex items-center gap-4 text-[10px] text-slate-600 font-mono">
            <span>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-700">Up</kbd>
              <kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-700">Down</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-700">Enter</kbd>
              select
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
