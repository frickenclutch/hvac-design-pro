import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, MapPin, Calendar, ArrowRight, Pencil, Check, X, Trash2, Building2, Home } from 'lucide-react';
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

const STORAGE_KEY = 'hvac_projects';

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

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Project>>({});
  const editNameRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setProjects(loadProjects());
  }, []);

  const handleNewProjectSuccess = (newProject: Project) => {
    const updated = [newProject, ...projects];
    setProjects(updated);
    saveProjects(updated);
    navigate(`/project/${newProject.id}/cad`);
  };

  const startEditing = (proj: Project) => {
    setEditingId(proj.id);
    setEditDraft({ name: proj.name, address: proj.address, city: proj.city, type: proj.type });
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
  };

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

      <div className="flex gap-4 mb-8">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8 gap-6 overflow-y-auto pb-20 pr-4">
          {filtered.map(proj => {
            const isEditing = editingId === proj.id;

            return (
              <div key={proj.id} className="glass-panel p-6 rounded-3xl hover:border-emerald-500/30 transition-all duration-300 group relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 flex items-center gap-2">
                  {!isEditing && (
                    <button
                      onClick={() => startEditing(proj)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/50 transition-colors opacity-0 group-hover:opacity-100"
                      title="Edit project details"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full ${proj.status === 'Completed' ? 'bg-slate-800 text-slate-300' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                    {proj.status}
                  </span>
                </div>

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
                    <h3 className="text-xl font-bold text-white mb-1 group-hover:text-emerald-300 transition-colors">{proj.name}</h3>
                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-6">
                      <span className="bg-slate-800 px-2 py-0.5 rounded-md text-slate-300 text-xs">{proj.type}</span>
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

                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/0 to-emerald-500/0 group-hover:via-emerald-500/5 blur-2xl transition-all duration-700 pointer-events-none rounded-3xl" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
