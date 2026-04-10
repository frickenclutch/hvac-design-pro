import React, { useState, useEffect, lazy, Suspense } from 'react';
import { ArrowLeft, Save, Undo2, Redo2, Download, Zap, Box, Search, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import AssetSearch from './AssetSearch';
import ErrorBoundary from '../../../components/ErrorBoundary';
import { Link, useParams } from 'react-router-dom';
import { useCadStore } from '../store/useCadStore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { useProjectStore } from '../../../stores/useProjectStore';

// Lazy-load heavy dependencies (Three.js ~1.2MB, jsPDF ~200KB)
const Viewer3D = lazy(() => import('./Viewer3D'));

export default function TopNavigationBar({ onHelpOpen }: { onHelpOpen?: () => void }) {
  const { id } = useParams();
  const { canvas, undo, redo, isDirty, isSaving, lastSavedAt, saveError, panelNavBar, setPanelNavBar } = useCadStore();
  const [show3D, setShow3D] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const { user, organisation } = useAuthStore();
  const { activeProjectName, activeProjectType, activeProjectAddress } = useProjectStore();

  // Derive display name — fall back gracefully when no project route
  const displayName = activeProjectName ?? (id ? `Project ${id}` : 'CAD Workspace');

  // Global Ctrl+K / Cmd+K shortcut for search
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const saveStatusText = saveError ? 'Save error' : isSaving ? 'Saving...' : isDirty ? 'Unsaved' : lastSavedAt ? 'Saved' : 'Draft';
  const saveStatusColor = saveError ? 'text-red-400 border-red-500/20 bg-red-500/10' : isSaving ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' : isDirty ? 'text-slate-400 border-slate-500/20 bg-slate-500/10' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10';

  const handleSave = () => {
    const data = useCadStore.getState().serializeDrawing();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hvac-project-${id || 'draft'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    if (!canvas) {
      console.warn('Canvas not found for PDF export.');
      return;
    }

    const metadata = {
      projectName: activeProjectName ?? displayName,
      engineerName: user ? `${user.firstName} ${user.lastName}` : 'HVAC Engineer',
      organisationName: organisation?.name || 'HVAC Design Pro',
      date: new Date().toLocaleDateString(),
      region: organisation?.regionCode || 'NA_ASHRAE',
      projectId: id || 'DRAFT',
    };

    const storeFloors = useCadStore.getState().floors;
    const floors = storeFloors.map((f) => ({
      name: f.name,
      heightFt: f.heightFt,
      walls: f.walls.map((w) => ({
        id: w.id,
        x1: w.x1,
        y1: w.y1,
        x2: w.x2,
        y2: w.y2,
        thicknessIn: w.thicknessIn,
        rValue: w.rValue,
        material: w.material,
      })),
      openings: f.openings.map((o) => ({
        id: o.id,
        type: o.type,
        wallId: o.wallId,
        widthIn: o.widthIn,
        heightIn: o.heightIn,
        uFactor: o.uFactor,
        shgc: o.shgc,
        glassType: o.glassType,
        swingDirection: o.swingDirection,
      })),
      hvacUnits: f.hvacUnits.map((h) => ({
        id: h.id,
        type: h.type,
        cfm: h.cfm,
        label: h.label,
      })),
      rooms: f.rooms.map((r) => ({
        name: r.name,
        areaSqFt: r.areaSqFt,
        perimeterFt: r.perimeterFt,
      })),
      annotations: f.annotations.map((a) => ({
        type: a.type,
        text: a.text,
      })),
    }));

    const { generatePdfPlot } = await import('../utils/pdfGenerator');
    generatePdfPlot(canvas, metadata, floors, null);
  };

  if (!panelNavBar) {
    return (
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
        <div className="flex items-center justify-center pt-2 pointer-events-auto">
          <button
            onClick={() => setPanelNavBar(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-b-xl bg-slate-900/70 border border-slate-700/50 border-t-0 backdrop-blur-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all shadow-[0_5px_15px_rgba(0,0,0,0.4)]"
            title="Show Navigation Bar (N)"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 3D Viewer Modal */}
        {show3D && <ErrorBoundary label="3D Viewer"><Suspense fallback={null}><Viewer3D isOpen={show3D} onClose={() => setShow3D(false)} /></Suspense></ErrorBoundary>}
        <AssetSearch isOpen={showSearch} onClose={() => setShowSearch(false)} />
      </div>
    );
  }

  return (
    <div className="absolute top-0 left-0 right-0 h-16 z-20 pointer-events-none">
      <div className="h-full px-6 flex items-center justify-between pointer-events-auto bg-gradient-to-b from-slate-950/90 to-transparent">

        {/* Left Side */}
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-900/80 border border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-800 transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-slate-100 tracking-wide drop-shadow-md">{displayName}</h2>
              {activeProjectType && (
                <span className="text-[10px] text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded font-mono uppercase tracking-widest">{activeProjectType}</span>
              )}
              <span className={`${saveStatusColor} text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded border`}>{saveStatusText}</span>
            </div>
            <span className="text-xs text-slate-500 font-mono truncate max-w-xs">
              {activeProjectAddress ?? (id ? `ID: ${id}` : 'No project loaded')}
            </span>
          </div>
        </div>

        {/* Center - Global Actions */}
        <div className="hidden md:flex items-center gap-2 glass-panel rounded-full px-4 py-2 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <ActionButton icon={<Undo2 className="w-4 h-4" />} tooltip="Undo (Ctrl+Z)" onClick={undo} />
          <ActionButton icon={<Redo2 className="w-4 h-4" />} tooltip="Redo (Ctrl+Y)" onClick={redo} />
          <div className="w-px h-4 bg-slate-700/60 mx-2" />
          <ActionButton icon={<Zap className="w-4 h-4" />} tooltip="Auto-Calculate Load" highlight />
          <div className="w-px h-4 bg-slate-700/60 mx-2" />
          <ActionButton icon={<Search className="w-4 h-4" />} tooltip="Search (Ctrl+K)" onClick={() => setShowSearch(true)} />
          <ActionButton icon={<HelpCircle className="w-4 h-4" />} tooltip="Help Center" onClick={onHelpOpen} />
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
           <button
             onClick={() => setPanelNavBar(false)}
             className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
             title="Hide Navigation (N)"
           >
             <ChevronUp className="w-4 h-4" />
           </button>
           <button
             onClick={() => setShow3D(true)}
             className="flex items-center gap-2 bg-slate-900/80 text-slate-300 px-4 py-2.5 rounded-xl text-sm font-semibold hover:text-white hover:bg-slate-800 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)] border border-slate-700/50 backdrop-blur-md"
           >
             <Box className="w-4 h-4" /> 3D View
           </button>
           <button
             onClick={handleExport}
             aria-label="Export PDF"
             className="flex items-center gap-2 bg-slate-900/80 text-slate-300 px-4 py-2.5 rounded-xl text-sm font-semibold hover:text-white hover:bg-slate-800 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)] border border-slate-700/50 backdrop-blur-md"
           >
             <Download className="w-4 h-4" /> Export PDF
           </button>
           <button
             onClick={handleSave}
             aria-label="Save Project"
             className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald-500/20 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)] border border-emerald-500/30 backdrop-blur-md"
           >
             <Save className="w-4 h-4" /> Save
           </button>
        </div>

      </div>

      {/* 3D Viewer Modal */}
      {show3D && <ErrorBoundary label="3D Viewer"><Suspense fallback={null}><Viewer3D isOpen={show3D} onClose={() => setShow3D(false)} /></Suspense></ErrorBoundary>}

      {/* Asset Search Modal */}
      <AssetSearch isOpen={showSearch} onClose={() => setShowSearch(false)} />
    </div>
  );
}

function ActionButton({ icon, tooltip, highlight, onClick }: { icon: React.ReactNode; tooltip: string; highlight?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`p-2 rounded-full transition-colors group relative ${highlight ? 'text-emerald-400 hover:bg-emerald-500/20' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`} aria-label={tooltip}>
      {icon}
      {/* Tooltip */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 bg-slate-800 text-slate-200 text-[10px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-slate-700">
        {tooltip}
      </div>
    </button>
  );
}
