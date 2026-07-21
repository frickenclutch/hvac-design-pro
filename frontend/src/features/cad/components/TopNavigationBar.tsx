import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { ArrowLeft, Save, Undo2, Redo2, Download, Zap, Box, Search, ChevronDown, ChevronUp, HelpCircle, Pencil, X, ArrowRight, Building2, Home, MapPin, Briefcase, Check, History, Settings, LogOut, ShieldCheck } from 'lucide-react';
import AssetSearch from './AssetSearch';
import ErrorBoundary from '../../../components/ErrorBoundary';
import { scopedKey } from '../../../utils/storage';
import newProjectGear from '../../../assets/brand/new-project-gear.png';
import cadPortalBlackhole from '../../../assets/brand/cad-portal-blackhole.png';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useCadStore } from '../store/useCadStore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useAccessPolicyStore } from '../../../stores/useAccessPolicyStore';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';

// Lazy-load heavy dependencies (Three.js ~1.2MB, jsPDF ~200KB)
const Viewer3D = lazy(() => import('./Viewer3D'));

export default function TopNavigationBar({ onHelpOpen, onVersionsOpen }: { onHelpOpen?: () => void; onVersionsOpen?: () => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canvas, undo, redo, isDirty, isSaving, lastSavedAt, saveError, panelNavBar, setPanelNavBar, setIs3DViewOpen } = useCadStore();
  const [show3D, setShow3DLocal] = useState(false);
  const setShow3D = (v: boolean) => { setShow3DLocal(v); setIs3DViewOpen(v); };
  const canViewVersions = useAccessPolicyStore((s) => s.capabilities.canViewVersions);
  const [showSearch, setShowSearch] = useState(false);
  const { user, organisation, logout } = useAuthStore();
  const avatarDataUrl = usePreferencesStore((s) => s.avatarDataUrl);
  const { activeProjectName, activeProjectType, activeProjectAddress, renameProject, createProject, activeProjectId } = useProjectStore();

  // Identity for the Creation Portal header (the avatar now lives inside the portal).
  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || '?';
  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : '';

  // ── Inline title editing ────────────────────────────────────────────────
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // ── Project creation modal ──────────────────────────────────────────────
  // 'saveAs'     — draft mode Save: create a project and keep the drawing.
  // 'newProject' — creation portal: spin up a fresh workspace from the canvas.
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [modalMode, setModalMode] = useState<'saveAs' | 'newProject'>('saveAs');
  const [saveStep, setSaveStep] = useState(1);
  const [saveName, setSaveName] = useState('');
  const [saveType, setSaveType] = useState('Residential');
  const [saveAddress, setSaveAddress] = useState('');
  const [saveCity, setSaveCity] = useState('');
  const [isSavingProject, setIsSavingProject] = useState(false);

  // ── Creation portal dropdown ────────────────────────────────────────────
  const [portalOpen, setPortalOpen] = useState(false);
  const portalRef = useRef<HTMLDivElement>(null);

  // Gravity pulse — the black-hole face implodes and springs back on every
  // toggle. Reset-then-set (via rAF) so rapid clicks restart the animation.
  const [portalPulse, setPortalPulse] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firePortalPulse = () => {
    setPortalPulse(false);
    requestAnimationFrame(() => setPortalPulse(true));
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPortalPulse(false), 550);
  };

  useEffect(() => {
    if (!portalOpen) return;
    const onDown = (e: PointerEvent) => {
      if (portalRef.current && !portalRef.current.contains(e.target as Node)) setPortalOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPortalOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [portalOpen]);

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
  // Enamel badge variant for the sheet-metal portal menu — solid plates stay
  // legible on the knurled fill where translucent tints wash out.
  const portalPillClass = saveError ? 'bg-red-700 border-red-900/60 text-red-50' : isSaving ? 'bg-amber-400 border-amber-700/60 text-amber-950' : isDirty ? 'bg-slate-700 border-slate-900/60 text-slate-100' : 'bg-emerald-700 border-emerald-900/60 text-emerald-50';

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

  const openProjectModal = (mode: 'saveAs' | 'newProject') => {
    setModalMode(mode);
    setSaveName('');
    setSaveType('Residential');
    setSaveAddress('');
    setSaveCity('');
    setSaveStep(1);
    setShowSaveModal(true);
  };

  const handleSave = () => {
    if (isDraft) {
      // No project exists yet — open the save-as modal
      openProjectModal('saveAs');
      return;
    }

    // Immediate save to localStorage + trigger auto-save
    const store = useCadStore.getState();
    try {
      const data = store.serializeDrawing();
      localStorage.setItem(scopedKey(`hvac_cad_${activeProjectId}`), JSON.stringify(data));
      store.markSaved(store.drawingId || 'local');
    } catch {
      store.markDirty();
    }
  };

  const handleSaveModalSubmit = async () => {
    if (!saveName.trim() || isSavingProject) return;
    setIsSavingProject(true);
    try {
      if (modalMode === 'newProject') {
        // Preserve the current workspace before leaving it — auto-save covers
        // this too, but a synchronous flush costs nothing and closes the gap.
        if (activeProjectId) {
          try {
            const store = useCadStore.getState();
            localStorage.setItem(scopedKey(`hvac_cad_${activeProjectId}`), JSON.stringify(store.serializeDrawing()));
          } catch { /* best-effort */ }
        }
        const newId = await createProject({
          name: saveName.trim(),
          type: saveType,
          address: saveAddress,
          city: saveCity,
        });
        setShowSaveModal(false);
        // Switch the workspace — CadWorkspace's load effect sees the new
        // route id, resets to a clean slate, and starts the fresh drawing.
        navigate(`/project/${newId}/cad`);
        return;
      }

      const newId = await createProject({
        name: saveName.trim(),
        type: saveType,
        address: saveAddress,
        city: saveCity,
      });
      setShowSaveModal(false);

      // Update the CAD store's projectId so auto-save targets this project
      const store = useCadStore.getState();
      store.setProjectId(newId);

      // Immediately persist current drawing to localStorage under the new project key
      try {
        const data = store.serializeDrawing();
        localStorage.setItem(scopedKey(`hvac_cad_${newId}`), JSON.stringify(data));
        store.markSaved(store.drawingId || 'local');
      } catch {
        store.markDirty();
      }

      // Navigate to the project-specific CAD route.
      // The layout route in App.tsx keeps CadWorkspace mounted (no canvas destruction).
      navigate(`/project/${newId}/cad`, { replace: true });
    } finally {
      setIsSavingProject(false);
    }
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
          {canViewVersions && (
            <ActionButton icon={<History className="w-4 h-4" />} tooltip="Version history — restore any prior save" onClick={onVersionsOpen} />
          )}
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
           {/* ── Creation portal — save, new-project, 3D + export ─────── */}
           <div className="relative" ref={portalRef}>
             <button
               onClick={() => { setPortalOpen(v => !v); firePortalPulse(); }}
               aria-label="Creation portal — save, new project, 3D view, or export PDF"
               aria-expanded={portalOpen}
               aria-haspopup="menu"
               className={`portal-button-metallic relative min-h-[44px] min-w-[44px] w-11 h-11 rounded-2xl overflow-hidden flex items-center justify-center transition-transform duration-200 ${portalOpen ? 'scale-105' : 'hover:scale-105'}${portalPulse ? ' portal-implode' : ''}`}
             >
               <span aria-hidden className="portal-ring-metallic absolute inset-[-50%]" />
               <span aria-hidden className="absolute inset-[2px] rounded-[14px] bg-slate-950/95" />
               {/* Platinum/copper black-hole face — spins as the portal opens */}
               <img
                 src={cadPortalBlackhole}
                 alt=""
                 aria-hidden
                 className={`absolute inset-[2px] z-10 rounded-[14px] object-cover transition-transform duration-700 ${portalOpen ? 'rotate-180' : ''}`}
               />
               {isDirty && !isSaving && (
                 <span aria-hidden className="absolute top-[5px] right-[5px] z-20 w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
               )}
             </button>

             {portalOpen && (
               <div
                 role="menu"
                 className="portal-menu-emerge portal-menu-metal absolute right-0 top-full mt-3 w-72 z-50"
               >
                 {/* Specular sweep — glancing light over the whole plate */}
                 <span aria-hidden className="portal-menu-sheen absolute inset-0 pointer-events-none" />

                 {/* Identity — the user's avatar now lives in the portal */}
                 <div className="px-2.5 pt-2 pb-2.5 flex items-center gap-3 border-b border-slate-950/15">
                   <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-slate-900/40 bg-slate-800 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.4),0_1px_3px_rgba(0,0,0,0.4)]">
                     {avatarDataUrl
                       ? <img src={avatarDataUrl} alt="" className="w-full h-full object-cover" />
                       : <span className="text-sm font-bold text-slate-100">{initials}</span>}
                   </div>
                   <div className="min-w-0">
                     <p className="metal-ink text-sm font-bold truncate">{fullName || 'Your account'}</p>
                     <p className="metal-ink-soft text-[11px] font-semibold truncate">{user?.email}</p>
                   </div>
                 </div>

                 <div className="px-2.5 pt-1.5 pb-2 flex items-center justify-between">
                   <span className="metal-ink text-[10px] font-mono font-bold uppercase tracking-widest">Creation Portal</span>
                   <span className={`${portalPillClass} text-[9px] uppercase font-mono font-bold tracking-widest px-1.5 py-0.5 rounded border shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_1px_3px_rgba(0,0,0,0.4)]`}>{saveStatusText}</span>
                 </div>

                 <button
                   role="menuitem"
                   onClick={() => { setPortalOpen(false); handleSave(); }}
                   className="w-full min-h-[44px] flex items-center gap-3 px-2.5 py-3 text-left hover:bg-slate-950/15 transition-colors group"
                 >
                   <span className="w-9 h-9 rounded-xl bg-teal-600 border-2 border-teal-900/50 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_2px_5px_rgba(0,0,0,0.45)]">
                     <Save className="w-4 h-4 text-teal-50" />
                   </span>
                   <span className="flex flex-col">
                     <span className="text-sm font-bold metal-ink">{isDraft ? 'Save as Project' : 'Save'}</span>
                     <span className="text-xs font-semibold metal-ink-soft">
                       {saveError ? 'Save failed — try again' : isSaving ? 'Saving…' : isDraft ? 'Turn this draft into a project' : isDirty ? 'Unsaved changes' : 'All changes saved'}
                     </span>
                   </span>
                 </button>

                 <button
                   role="menuitem"
                   onClick={() => { setPortalOpen(false); openProjectModal('newProject'); }}
                   className="w-full min-h-[44px] flex items-center gap-3 px-2.5 py-3 text-left hover:bg-slate-950/15 transition-colors group"
                 >
                   <span className="w-9 h-9 rounded-xl bg-slate-600 border-2 border-slate-900/50 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_2px_5px_rgba(0,0,0,0.45)] overflow-hidden">
                     <img src={newProjectGear} alt="" aria-hidden className="w-7 h-7 rounded-full" />
                   </span>
                   <span className="flex flex-col">
                     <span className="text-sm font-bold metal-ink">New Project</span>
                     <span className="text-xs font-semibold metal-ink-soft">Fresh workspace — right from the canvas</span>
                   </span>
                 </button>

                 <button
                   role="menuitem"
                   onClick={() => { setPortalOpen(false); setShow3D(true); }}
                   className="w-full min-h-[44px] flex items-center gap-3 px-2.5 py-3 text-left hover:bg-slate-950/15 transition-colors group"
                 >
                   <span className="w-9 h-9 rounded-xl bg-violet-600 border-2 border-violet-900/50 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_2px_5px_rgba(0,0,0,0.45)]">
                     <Box className="w-4 h-4 text-violet-50" />
                   </span>
                   <span className="flex flex-col">
                     <span className="text-sm font-bold metal-ink">3D View</span>
                     <span className="text-xs font-semibold metal-ink-soft">Walk the model in three dimensions</span>
                   </span>
                 </button>

                 <button
                   role="menuitem"
                   onClick={() => { setPortalOpen(false); handleExport(); }}
                   className="w-full min-h-[44px] flex items-center gap-3 px-2.5 py-3 text-left hover:bg-slate-950/15 transition-colors group"
                 >
                   <span className="w-9 h-9 rounded-xl bg-amber-500 border-2 border-amber-800/60 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_2px_5px_rgba(0,0,0,0.45)]">
                     <Download className="w-4 h-4 text-amber-950" />
                   </span>
                   <span className="flex flex-col">
                     <span className="text-sm font-bold metal-ink">Export PDF</span>
                     <span className="text-xs font-semibold metal-ink-soft">Permit-ready plot of this drawing</span>
                   </span>
                 </button>

                 {/* ── Platform tabs — home base for settings + session ──────── */}
                 <div className="mx-2.5 my-1 h-px bg-slate-950/15" />

                 <Link
                   role="menuitem"
                   to="/settings"
                   onClick={() => setPortalOpen(false)}
                   className="w-full min-h-[44px] flex items-center gap-3 px-2.5 py-3 text-left hover:bg-slate-950/15 transition-colors group"
                 >
                   <span className="w-9 h-9 rounded-xl bg-slate-600 border-2 border-slate-900/50 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_2px_5px_rgba(0,0,0,0.45)]">
                     <Settings className="w-4 h-4 text-slate-50" />
                   </span>
                   <span className="flex flex-col">
                     <span className="text-sm font-bold metal-ink">Settings</span>
                     <span className="text-xs font-semibold metal-ink-soft">Your workbench — theme, units, profile</span>
                   </span>
                 </Link>

                 {user?.isPlatformAdmin && (
                   <Link
                     role="menuitem"
                     to="/admin"
                     onClick={() => setPortalOpen(false)}
                     className="w-full min-h-[44px] flex items-center gap-3 px-2.5 py-3 text-left hover:bg-slate-950/15 transition-colors group"
                   >
                     <span className="w-9 h-9 rounded-xl bg-amber-500 border-2 border-amber-800/60 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_2px_5px_rgba(0,0,0,0.45)]">
                       <ShieldCheck className="w-4 h-4 text-amber-950" />
                     </span>
                     <span className="flex flex-col">
                       <span className="text-sm font-bold metal-ink">Platform Admin</span>
                       <span className="text-xs font-semibold metal-ink-soft">L0 — cross-tenant controls</span>
                     </span>
                   </Link>
                 )}

                 <button
                   role="menuitem"
                   onClick={() => { setPortalOpen(false); logout(); }}
                   className="w-full min-h-[44px] flex items-center gap-3 px-2.5 py-3 text-left hover:bg-slate-950/15 transition-colors group"
                 >
                   <span className="w-9 h-9 rounded-xl bg-red-600 border-2 border-red-900/50 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_2px_5px_rgba(0,0,0,0.45)]">
                     <LogOut className="w-4 h-4 text-red-50" />
                   </span>
                   <span className="flex flex-col">
                     <span className="text-sm font-bold metal-ink">Sign Out</span>
                     <span className="text-xs font-semibold metal-ink-soft">End this session</span>
                   </span>
                 </button>
               </div>
             )}
           </div>
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
                  {saveStep === 1
                    ? (modalMode === 'newProject' ? 'Create New Project' : 'Save as New Project')
                    : 'Project Location'}
                </h2>
                <p className="text-slate-400 font-medium mt-1">
                  {saveStep === 1
                    ? (modalMode === 'newProject'
                        ? 'Spin up a fresh working space without leaving the canvas.'
                        : 'Create a workspace to save your drawing.')
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
                    disabled={!saveName.trim() || isSavingProject}
                    onClick={handleSaveModalSubmit}
                    className="flex-[2] py-4 rounded-2xl bg-emerald-500 text-slate-950 font-bold hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    <Check className="w-5 h-5" /> {isSavingProject ? 'Creating…' : modalMode === 'newProject' ? 'Create Project' : 'Create & Save'}
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
