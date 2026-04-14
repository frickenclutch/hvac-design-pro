import { useState, useRef, useEffect } from 'react';
import { ChevronDown, FolderOpen, Home, Building2 } from 'lucide-react';
import { useProjectStore } from '../stores/useProjectStore';

export default function ProjectContextBar() {
  const { activeProjectId, activeProjectName, activeProjectType, setActiveProject, getProjectList } = useProjectStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const projects = getProjectList();

  if (!activeProjectId) {
    return (
      <div className="mx-4 mt-2 mb-0 px-4 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="text-xs text-amber-400 font-medium">Working in Draft Mode</span>
        <span className="text-[10px] text-amber-500/60 ml-1">Data will not be linked to any project</span>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-2 mb-0" ref={dropdownRef}>
      <div className="px-4 py-2 rounded-xl bg-slate-800/30 border border-slate-700/40 flex items-center gap-3">
        {/* Project icon */}
        <div className="p-1.5 rounded-lg bg-emerald-500/10 flex-shrink-0">
          {activeProjectType === 'commercial'
            ? <Building2 className="w-3.5 h-3.5 text-emerald-400" />
            : <Home className="w-3.5 h-3.5 text-emerald-400" />}
        </div>

        {/* Project name */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-white truncate block">{activeProjectName || 'Unnamed Project'}</span>
        </div>

        {/* Type badge */}
        {activeProjectType && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded-md flex-shrink-0">
            {activeProjectType}
          </span>
        )}

        {/* Switch dropdown */}
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
        >
          Switch <ChevronDown className={`w-3 h-3 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown */}
      {dropdownOpen && projects.length > 0 && (
        <div className="absolute z-50 mt-1 right-4 w-72 glass-panel rounded-xl border border-slate-700/60 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="p-2 max-h-64 overflow-y-auto">
            {projects.map((p: any) => (
              <button
                key={p.id}
                onClick={() => {
                  setActiveProject(p.id);
                  setDropdownOpen(false);
                  // Force page reload to pick up new project's scoped data
                  window.location.reload();
                }}
                className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg text-left transition-all ${p.id === activeProjectId ? 'bg-emerald-500/10 border border-emerald-500/20' : 'hover:bg-slate-800/50 border border-transparent'}`}
              >
                {p.type === 'commercial'
                  ? <Building2 className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  : <Home className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{p.name}</p>
                  <p className="text-[9px] text-slate-600 truncate">{p.address || 'No address'}</p>
                </div>
                {p.id === activeProjectId && (
                  <span className="text-[8px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">ACTIVE</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
