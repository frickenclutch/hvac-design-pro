import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, MapPin, Calendar, ArrowRight, Pencil, Check, X, Trash2, Building2, Home, GripVertical, ChevronDown, ChevronRight, RotateCcw, Minus } from 'lucide-react';
import NewProjectModal from '../features/projects/components/NewProjectModal';

interface Project {
  id: string;
  name: string;
  address: string;
  city: string;
  date: string;
  status: string;
  type: string;
}

interface TileLayout {
  order: string[];
  collapsed: Record<string, boolean>;
  tileScale: number;
}

const STORAGE_KEY = 'hvac_projects';
const LAYOUT_KEY = 'hvac_project_layout';

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function loadLayout(): TileLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { order: [], collapsed: {}, tileScale: 1 };
    const parsed = JSON.parse(raw);
    return { order: parsed.order ?? [], collapsed: parsed.collapsed ?? {}, tileScale: parsed.tileScale ?? 1 };
  } catch {
    return { order: [], collapsed: {}, tileScale: 1 };
  }
}

function saveLayout(layout: TileLayout) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

/** Reconcile saved order with actual project IDs — new projects at top, deleted ones removed */
function reconcileLayout(layout: TileLayout, projects: Project[]): TileLayout {
  const projectIds = new Set(projects.map(p => p.id));
  const validOrder = layout.order.filter(id => projectIds.has(id));
  const newIds = projects.map(p => p.id).filter(id => !validOrder.includes(id));
  const order = [...newIds, ...validOrder];

  const collapsed: Record<string, boolean> = {};
  for (const id of order) {
    if (layout.collapsed[id]) collapsed[id] = true;
  }

  return { order, collapsed, tileScale: layout.tileScale ?? 1 };
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [layout, setLayout] = useState<TileLayout>({ order: [], collapsed: {}, tileScale: 1 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Project>>({});
  const editNameRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // ── Drag state ─────────────────────────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadProjects();
    const savedLayout = loadLayout();
    const reconciled = reconcileLayout(savedLayout, loaded);
    setProjects(loaded);
    setLayout(reconciled);
    saveLayout(reconciled);
  }, []);

  // ── Project CRUD ───────────────────────────────────────────────────────
  const handleNewProjectSuccess = (newProject: Project) => {
    const updated = [newProject, ...projects];
    setProjects(updated);
    saveProjects(updated);
    setLayout(prev => {
      const next = { ...prev, order: [newProject.id, ...prev.order] };
      saveLayout(next);
      return next;
    });
    navigate(`/project/${newProject.id}/cad`);
  };

  const startEditing = (proj: Project) => {
    setEditingId(proj.id);
    setEditDraft({ name: proj.name, address: proj.address, city: proj.city, type: proj.type });
    // Auto-expand if collapsed
    if (layout.collapsed[proj.id]) {
      toggleCollapse(proj.id);
    }
    setTimeout(() => editNameRef.current?.focus(), 50);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const updated = projects.map(p =>
      p.id === editingId ? { ...p, ...editDraft } : p
    );
    setProjects(updated);
    saveProjects(updated);
    setEditingId(null);
    setEditDraft({});
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft({});
  };

  const deleteProject = (id: string) => {
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    saveProjects(updated);
    if (editingId === id) cancelEdit();
    setLayout(prev => {
      const next = { ...prev, order: prev.order.filter(oid => oid !== id), collapsed: { ...prev.collapsed } };
      delete next.collapsed[id];
      saveLayout(next);
      return next;
    });
  };

  // ── Tile layout ────────────────────────────────────────────────────────
  const toggleCollapse = (id: string) => {
    setLayout(prev => {
      const next = { ...prev, collapsed: { ...prev.collapsed, [id]: !prev.collapsed[id] } };
      if (!next.collapsed[id]) delete next.collapsed[id];
      saveLayout(next);
      return next;
    });
  };

  const resetLayout = () => {
    const fresh: TileLayout = { order: projects.map(p => p.id), collapsed: {}, tileScale: 1 };
    setLayout(fresh);
    saveLayout(fresh);
  };

  const adjustTileScale = (delta: number) => {
    setLayout(prev => {
      const next = { ...prev, tileScale: Math.round(Math.min(1.25, Math.max(0.65, (prev.tileScale ?? 1) + delta)) * 100) / 100 };
      saveLayout(next);
      return next;
    });
  };

  // ── Drag-to-reorder ────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.PointerEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragId(projectId);

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (me: PointerEvent) => {
      // Hit-test: which tile is under the cursor?
      const els = document.elementsFromPoint(me.clientX, me.clientY);
      for (const el of els) {
        const tileEl = (el as HTMLElement).closest('[data-project-id]');
        if (tileEl) {
          const targetId = tileEl.getAttribute('data-project-id');
          if (targetId && targetId !== projectId) {
            setOverId(targetId);
            return;
          }
        }
      }
      setOverId(null);
    };

    const onUp = () => {
      setDragId(null);
      setOverId(prev => {
        if (prev) {
          // Commit the reorder
          setLayout(layout => {
            const arr = [...layout.order];
            const fromIdx = arr.indexOf(projectId);
            const toIdx = arr.indexOf(prev);
            if (fromIdx !== -1 && toIdx !== -1) {
              arr.splice(fromIdx, 1);
              arr.splice(toIdx, 0, projectId);
              const next = { ...layout, order: arr };
              saveLayout(next);
              return next;
            }
            return layout;
          });
        }
        return null;
      });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  // ── Sorted + filtered projects ─────────────────────────────────────────
  const sortedProjects = layout.order
    .map(id => projects.find(p => p.id === id))
    .filter((p): p is Project => !!p);

  const filtered = searchQuery
    ? sortedProjects.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.city.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sortedProjects;

  return (
    <div className="px-4 py-6 pt-8 md:p-8 md:pt-12 h-full flex flex-col overflow-y-auto">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 md:mb-10">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2">Project Workspace</h2>
          <p className="text-slate-400 text-sm md:text-base">Manage your active load calculations and duct designs.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold py-2.5 px-5 sm:px-6 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all transform hover:-translate-y-1 min-h-[44px] flex-shrink-0"
        >
          <Plus className="w-5 h-5" />
          <span className="hidden sm:block">New Project</span>
        </button>
      </header>

      <NewProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleNewProjectSuccess}
      />

      <div className="flex items-center gap-4 mb-8">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900/80 border border-slate-700/50 rounded-2xl py-3 pl-12 pr-4 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-medium"
          />
        </div>
        {projects.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => adjustTileScale(-0.1)}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors"
              title="Shrink tiles"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-slate-600 font-mono w-8 text-center">{Math.round((layout.tileScale ?? 1) * 100)}%</span>
            <button
              onClick={() => adjustTileScale(0.1)}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors"
              title="Grow tiles"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-5 bg-slate-800 mx-1" />
            <button
              onClick={resetLayout}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs font-medium px-3 py-2 rounded-xl hover:bg-slate-800/50 transition-colors"
              title="Reset tile order, scale, and expand all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center pb-20">
          <div className="w-20 h-20 rounded-3xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-center mb-6">
            <Plus className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-300 mb-2">No projects yet</h3>
          <p className="text-slate-500 mb-6 max-w-sm">Create your first project to start designing HVAC systems with Manual J calculations and CAD drawings.</p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold py-3 px-8 rounded-full transition-all"
          >
            Create First Project
          </button>
        </div>
      ) : (
        <div className="pb-20 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 auto-rows-min" style={{ zoom: layout.tileScale ?? 1 }}>
          {filtered.map(proj => {
            const isEditing = editingId === proj.id;
            const isCollapsed = !!layout.collapsed[proj.id] && !isEditing;
            const isDragging = dragId === proj.id;
            const isDropTarget = overId === proj.id && dragId !== null;

            return (
              <div
                key={proj.id}
                data-project-id={proj.id}
                className={`glass-panel rounded-3xl transition-all duration-200 group relative ${
                  isDragging ? 'opacity-50 scale-[1.02] ring-2 ring-emerald-500/40 shadow-[0_0_30px_rgba(0,0,0,0.5)] z-50' : ''
                } ${isDropTarget ? 'ring-2 ring-emerald-500/60 ring-offset-2 ring-offset-slate-950' : ''
                } ${isCollapsed ? '' : 'hover:border-emerald-500/30'}`}
              >
                {/* ── Tile Header (always visible) ──────────────────────── */}
                <div className={`flex items-center gap-3 ${isCollapsed ? 'px-5 py-3' : 'px-6 pt-5 pb-2'}`}>
                  {/* Drag handle */}
                  <div
                    onPointerDown={e => onDragStart(e, proj.id)}
                    className="cursor-grab active:cursor-grabbing p-1 rounded-md text-slate-600 hover:text-slate-400 hover:bg-slate-800/50 transition-colors touch-none"
                    title="Drag to reorder"
                  >
                    <GripVertical className="w-4 h-4" />
                  </div>

                  {/* Project name */}
                  <h3 className={`font-bold text-white flex-1 truncate ${isCollapsed ? 'text-sm' : 'text-xl group-hover:text-emerald-300'} transition-colors`}>
                    {proj.name}
                  </h3>

                  {/* Badges */}
                  <span className="bg-slate-800 px-2 py-0.5 rounded-md text-slate-300 text-xs flex-shrink-0">
                    {proj.type === 'Residential' ? 'Res' : proj.type === 'Commercial' ? 'Com' : proj.type}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full flex-shrink-0 ${proj.status === 'Completed' ? 'bg-slate-800 text-slate-300' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                    {proj.status}
                  </span>

                  {/* Collapse/expand toggle */}
                  {!isEditing && (
                    <button
                      onClick={() => toggleCollapse(proj.id)}
                      className="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
                      title={isCollapsed ? 'Expand tile' : 'Collapse tile'}
                    >
                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  )}

                  {/* Quick open (collapsed only) */}
                  {isCollapsed && (
                    <Link
                      to={`/project/${proj.id}/cad`}
                      className="p-1 rounded-lg text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      title="Open Workspace"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  )}
                </div>

                {/* ── Expanded content ──────────────────────────────────── */}
                {!isCollapsed && (
                  <div className="px-6 pb-6">
                    {isEditing ? (
                      <>
                        {/* Editable name */}
                        <input
                          ref={editNameRef}
                          value={editDraft.name ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          className="text-xl font-bold text-white bg-slate-800/60 border border-slate-600/50 rounded-xl px-3 py-1.5 mb-2 w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          placeholder="Project name"
                        />

                        {/* Editable type */}
                        <div className="flex gap-2 mb-4">
                          <button
                            onClick={() => setEditDraft(d => ({ ...d, type: 'Residential' }))}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${editDraft.type === 'Residential' ? 'bg-emerald-500/10 border border-emerald-500/50 text-emerald-400' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'}`}
                          >
                            <Home className="w-3 h-3" /> Residential
                          </button>
                          <button
                            onClick={() => setEditDraft(d => ({ ...d, type: 'Commercial' }))}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${editDraft.type === 'Commercial' ? 'bg-emerald-500/10 border border-emerald-500/50 text-emerald-400' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'}`}
                          >
                            <Building2 className="w-3 h-3" /> Commercial
                          </button>
                        </div>

                        {/* Editable address / city */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <input
                            value={editDraft.address ?? ''}
                            onChange={e => setEditDraft(d => ({ ...d, address: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            className="bg-slate-800/60 border border-slate-600/50 rounded-xl px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            placeholder="Address"
                          />
                          <input
                            value={editDraft.city ?? ''}
                            onChange={e => setEditDraft(d => ({ ...d, city: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            className="bg-slate-800/60 border border-slate-600/50 rounded-xl px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            placeholder="City"
                          />
                        </div>

                        {/* Save / Cancel / Delete */}
                        <div className="flex items-center gap-2 border-t border-slate-800/50 pt-4">
                          <button
                            onClick={saveEdit}
                            disabled={!editDraft.name?.trim()}
                            className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                          >
                            <Check className="w-4 h-4" /> Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="flex items-center gap-1.5 text-slate-400 hover:text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-slate-800 transition-all"
                          >
                            <X className="w-4 h-4" /> Cancel
                          </button>
                          <div className="flex-1" />
                          <button
                            onClick={() => deleteProject(proj.id)}
                            className="flex items-center gap-1.5 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-xl text-sm font-semibold transition-all"
                            title="Delete project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Edit button (hover-visible) */}
                        <div className="flex justify-end -mt-1 mb-2">
                          <button
                            onClick={() => startEditing(proj)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/50 transition-colors opacity-0 group-hover:opacity-100"
                            title="Edit project details"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-8">
                          <div className="flex items-center gap-2 text-slate-400 text-sm">
                            <MapPin className="w-4 h-4 text-slate-500" />
                            <span className="truncate">{proj.address}{proj.city ? `, ${proj.city}` : ''}</span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-400 text-sm">
                            <Calendar className="w-4 h-4 text-slate-500" />
                            <span>{new Date(proj.date).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <div className="flex justify-end border-t border-slate-800/50 pt-4 mt-auto">
                          <Link to={`/project/${proj.id}/cad`} className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-semibold group-hover:gap-3 transition-all">
                            Open Workspace <ArrowRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/0 to-emerald-500/0 group-hover:via-emerald-500/5 blur-none group-hover:blur-2xl transition-all duration-700 pointer-events-none rounded-3xl" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
