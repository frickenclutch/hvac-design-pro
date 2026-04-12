import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { ArrowLeft, Save, Undo2, Redo2, Download, Zap, Box, Search, ChevronDown, ChevronUp, HelpCircle, Pencil, X, ArrowRight, Building2, Home, MapPin, Briefcase, Check } from 'lucide-react';
import AssetSearch from './AssetSearch';
import ErrorBoundary from '../../../components/ErrorBoundary';
import UserAvatarMenu from '../../../components/UserAvatarMenu';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useCadStore } from '../store/useCadStore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { useProjectStore } from '../../../stores/useProjectStore';

// Lazy-load heavy dependencies (Three.js ~1.2MB, jsPDF ~200KB)
const Viewer3D = lazy(() => import('./Viewer3D'));

export default function TopNavigationBar({ onHelpOpen }: { onHelpOpen?: () => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canvas, undo, redo, isDirty, isSaving, lastSavedAt, saveError, panelNavBar, setPanelNavBar, setIs3DViewOpen } = useCadStore();
  const [show3D, setShow3DLocal] = useState(false);
  const setShow3D = (v: boolean) => { setShow3DLocal(v); setIs3DViewOpen(v); };
  const [showSearch, setShowSearch] = useState(false);
  const { user, organisation } = useAuthStore();
  const { activeProjectName, activeProjectType, activeProjectAddress, renameProject, createProject, activeProjectId } = useProjectStore();

  // ── Inline title editing ────────────────────────────────────────────────
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // ── Save-as-project modal for drafts ────────────────────────────────────
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveStep, setSaveStep] = useState(1);
  const [saveName, setSaveName] = useState('');
  const [saveType, setSaveType] = useState('Residential');
  const [saveAddress, setSaveAddress] = useState('');
  const [saveCity, setSaveCity] = useState('');

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

  // Focus the title input when entering edit mode
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const saveStatusText = saveError ? 'Save error' : isSaving ? 'Saving...' : isDirty ? 'Unsaved' : lastSavedAt ? 'Saved' : 'Draft';
  const saveStatusColor = saveError ? 'text-red-400 border-red-500/20 bg-red-500/10' : isSaving ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' : isDirty ? 'text-slate-400 border-slate-500/20 bg-slate-500/10' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10';

  const titleCommittedRef = useRef(false);

  const handleTitleDoubleClick = () => {
    titleCommittedRef.current = false;
    setTitleDraft(activeProjectName || '');
    setIsEditingTitle(true);
  };

  const commitTitleEdit = () => {
    // Guard against double-fire (Enter keydown + blur on unmount)
    if (titleCommittedRef.current) return;
    titleCommittedRef.current = true;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== activeProjectName) {
      renameProject(trimmed);
    }
    setIsEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    titleCommittedRef.current = true;
    setIsEditingTitle(false);
  };

  // ── Save handler ──────────────────────────────────────────────────────────
  const isDraft = !activeProjectId;

  const handleSave = () => {
    if (isDraft) {
      // No project exists yet — open the save-as modal
      setSaveName('');
      setSaveType('Residential');
      setSaveAddress('');
      setSaveCity('');
      setSaveStep(1);
      setShowSaveModal(true);
      return;
    }

    // Immediate save to localStorage + trigger auto-save
    const store = useCadStore.getState();
    try {
      const data = store.serializeDrawing();
      localStorage.setItem(`hvac_cad_${activeProjectId}`, JSON.stringify(data));
      store.markSaved(store.drawingId || 'local');
    } catch {
      store.markDirty();
    }
  };

  const handleSaveModalSubmit = () => {
    if (!saveName.trim()) return;
    const newId = createProject({ name: saveName.trim(), type: saveType, address: saveAddress, city: saveCity });
    setShowSaveModal(false);

    // Update the CAD store's projectId so auto-save targets this project
    const store = useCadStore.getState();
    store.setProjectId(newId);

    // Immediately persist current drawing to localStorage under the new project key
    try {
      const data = store.serializeDrawing();
      localStorage.setItem(`hvac_cad_${newId}`, JSON.stringify(data));
      store.markSaved(store.drawingId || 'local');
    } catch {
      store.markDirty();
    }

    // Navigate to the project-specific CAD route.
    // The layout route in App.tsx keeps CadWorkspace mounted (no canvas destruction).
    navigate(`/project/${newId}/cad`, { replace: true });
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
      projectId: activeProjectId || id || 'DRAFT',
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
              {isEditingTitle ? (
                <div className="flex items-center gap-2" onMouseDown={e => e.stopPropagation()}>
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitTitleEdit(); } if (e.key === 'Escape') cancelTitleEdit(); }}
                    onBlur={commitTitleEdit}
                    className="text-lg font-bold text-white bg-slate-800/80 border border-emerald-500/50 rounded-lg px-3 py-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 w-64"
                    placeholder="Project name"
                  />
                </div>
              ) : (
                <h2
                  className="text-lg font-bold text-slate-100 tracking-wide drop-shadow-md cursor-pointer hover:text-emerald-300 transition-colors group flex items-center gap-2"
                  onDoubleClick={handleTitleDoubleClick}
                  title="Double-click to rename"
                >
                  {displayName}
                  <Pencil className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </h2>
              )}
              {!isEditingTitle && activeProjectType && (
                <span className="text-[10px] text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded font-mono uppercase tracking-widest">{activeProjectType}</span>
              )}
              <span className={`${saveStatusColor} text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded border`}>{saveStatusText}</span>
            </div>
            <span className="text-xs text-slate-500 font-mono truncate max-w-xs">
              {activeProjectAddress ?? (activeProjectId ? `ID: ${activeProjectId}` : 'No project — save to create one')}
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
           <UserAvatarMenu size={34} compact />
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
             <Save className="w-4 h-4" /> {isDraft ? 'Save Project' : 'Save'}
           </button>
        </div>

      </div>

      {/* 3D Viewer Modal */}
      {show3D && <ErrorBoundary label="3D Viewer"><Suspense fallback={null}><Viewer3D isOpen={show3D} onClose={() => setShow3D(false)} /></Suspense></ErrorBoundary>}

      {/* Asset Search Modal */}
      <AssetSearch isOpen={showSearch} onClose={() => setShowSearch(false)} />

      {/* Save-as-Project Modal (shown in draft mode) */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-auto" onMouseDown={e => e.stopPropagation()}>
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setShowSaveModal(false)} />
          <div className="relative w-full max-w-lg glass-panel rounded-[2.5rem] border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300" onMouseDown={e => e.stopPropagation()}>
            <button onClick={() => setShowSaveModal(false)} className="absolute top-6 right-6 p-2 rounded-full bg-slate-900 border border-slate-800 text-slate-500 hover:text-white transition-colors z-50">
              <X className="w-5 h-5" />
            </button>

            <div className="p-10">
              <div className="mb-8">
                <div className="flex gap-1.5 mb-6">
                  {[1, 2].map(s => (
                    <div key={s} className={`h-1.5 flex-1 rounded-full transition-all ${saveStep >= s ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-slate-800'}`} />
                  ))}
                </div>
                <h2 className="text-3xl font-extrabold text-white tracking-tight">
                  {saveStep === 1 ? 'Save as New Project' : 'Project Location'}
                </h2>
                <p className="text-slate-400 font-medium mt-1">
                  {saveStep === 1
                    ? 'Create a workspace to save your drawing.'
                    : 'Optional — add a location for this project.'}
                </p>
              </div>

              <div className="space-y-6">
                {saveStep === 1 && (
                  <div className="animate-in slide-in-from-right-4 fade-in duration-500">
                    <div className="mb-6">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Project Name</label>
                      <div className="relative">
                        <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                        <input
                          value={saveName}
                          onChange={e => setSaveName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && saveName.trim()) setSaveStep(2); }}
                          placeholder="e.g. Henderson Office HVAC"
                          className="w-full bg-slate-900/80 border border-slate-700/50 rounded-2xl py-3.5 pl-12 pr-4 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-medium"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setSaveType('Residential')}
                        className={`p-5 rounded-2xl border transition-all flex flex-col items-center gap-2 ${saveType === 'Residential' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'}`}
                      >
                        <Home className="w-5 h-5" />
                        <span className="font-bold text-sm">Residential</span>
                      </button>
                      <button
                        onClick={() => setSaveType('Commercial')}
                        className={`p-5 rounded-2xl border transition-all flex flex-col items-center gap-2 ${saveType === 'Commercial' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'}`}
                      >
                        <Building2 className="w-5 h-5" />
                        <span className="font-bold text-sm">Commercial</span>
                      </button>
                    </div>
                  </div>
                )}

                {saveStep === 2 && (
                  <div className="animate-in slide-in-from-right-4 fade-in duration-500 space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Street Address</label>
                      <div className="relative">
                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                        <input
                          value={saveAddress}
                          onChange={e => setSaveAddress(e.target.value)}
                          placeholder="Main St"
                          className="w-full bg-slate-900/80 border border-slate-700/50 rounded-2xl py-3.5 pl-12 pr-4 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-medium"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">City</label>
                      <input
                        value={saveCity}
                        onChange={e => setSaveCity(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveModalSubmit(); }}
                        placeholder="Chicago"
                        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-2xl py-3.5 px-4 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-medium"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-10 flex justify-between gap-4">
                {saveStep > 1 ? (
                  <button
                    onClick={() => setSaveStep(s => s - 1)}
                    className="flex-1 py-4 rounded-2xl bg-slate-900 text-slate-400 font-bold hover:text-white transition-all flex items-center justify-center gap-2"
                  >
                    Back
                  </button>
                ) : (
                  <Link
                    to="/dashboard"
                    onClick={() => setShowSaveModal(false)}
                    className="flex-1 py-4 rounded-2xl bg-slate-900 text-slate-400 font-bold hover:text-white transition-all flex items-center justify-center gap-2"
                  >
                    Go to Projects
                  </Link>
                )}

                {saveStep < 2 ? (
                  <button
                    disabled={!saveName.trim()}
                    onClick={() => setSaveStep(2)}
                    className="flex-[2] py-4 rounded-2xl bg-slate-100 text-slate-950 font-bold hover:shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    Continue <ArrowRight className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    disabled={!saveName.trim()}
                    onClick={handleSaveModalSubmit}
                    className="flex-[2] py-4 rounded-2xl bg-emerald-500 text-slate-950 font-bold hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    <Check className="w-5 h-5" /> Create &amp; Save
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
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
