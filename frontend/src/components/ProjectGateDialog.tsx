import { useState } from 'react';
import { FolderOpen, Plus, FileText, Home, Building2 } from 'lucide-react';
import { useProjectStore } from '../stores/useProjectStore';
import { getCachedProjects, type Project } from '../features/projects/projectStorage';

interface ProjectGateDialogProps {
  onProjectSelected: (projectId: string) => void;
  onDraft: () => void;
}

export default function ProjectGateDialog({ onProjectSelected, onDraft }: ProjectGateDialogProps) {
  const { setActiveProject, createProject } = useProjectStore();
  const projects: Project[] = getCachedProjects();
  const [mode, setMode] = useState<'select' | 'create'>('select');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'residential' | 'commercial'>('residential');
  const [newAddress, setNewAddress] = useState('');
  const [creating, setCreating] = useState(false);

  const handleSelectProject = (id: string) => {
    setActiveProject(id);
    onProjectSelected(id);
  };

  const handleCreateProject = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createProject({
        name: newName.trim(),
        type: newType,
        address: newAddress.trim(),
        city: '',
      });
      onProjectSelected(id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-lg mx-4 rounded-3xl border border-slate-700/60 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-4">
          <h2 className="text-xl font-bold text-white mb-1">Select a Project</h2>
          <p className="text-sm text-slate-400">
            Choose which project to work in, or start a new one. Each project keeps its calculations and drawings separate.
          </p>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-2 px-8 mb-4">
          <button
            onClick={() => setMode('select')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${mode === 'select' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800/50 text-slate-500 border border-slate-700/50 hover:text-slate-300'}`}
          >
            <FolderOpen className="w-3.5 h-3.5 inline mr-1.5" /> Existing Project
          </button>
          <button
            onClick={() => setMode('create')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${mode === 'create' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800/50 text-slate-500 border border-slate-700/50 hover:text-slate-300'}`}
          >
            <Plus className="w-3.5 h-3.5 inline mr-1.5" /> New Project
          </button>
        </div>

        <div className="px-8 pb-6">
          {mode === 'select' ? (
            <>
              {projects.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {projects.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectProject(p.id)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/40 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all text-left group"
                    >
                      <div className="p-2 rounded-lg bg-slate-700/50 group-hover:bg-emerald-500/10 transition-colors">
                        {p.type === 'commercial' ? <Building2 className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" /> : <Home className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{p.address || 'No address'} {p.type ? `\u00b7 ${p.type}` : ''}</p>
                      </div>
                      <span className="text-[10px] text-slate-600">{p.status}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FolderOpen className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No projects yet</p>
                  <button onClick={() => setMode('create')} className="text-xs text-emerald-400 font-semibold mt-2 hover:text-emerald-300">
                    Create your first project
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {/* Project name */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Project Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g., Smith Residence"
                  autoFocus
                  className="w-full bg-slate-950/80 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-slate-600"
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Building Type</label>
                <div className="flex gap-2">
                  <button onClick={() => setNewType('residential')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${newType === 'residential' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800/50 text-slate-500 border border-slate-700/50'}`}>
                    <Home className="w-4 h-4" /> Residential
                  </button>
                  <button onClick={() => setNewType('commercial')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${newType === 'commercial' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800/50 text-slate-500 border border-slate-700/50'}`}>
                    <Building2 className="w-4 h-4" /> Commercial
                  </button>
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Address (optional)</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={e => setNewAddress(e.target.value)}
                  placeholder="123 Main St, City, State"
                  className="w-full bg-slate-950/80 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-slate-600"
                />
              </div>

              {/* Create button */}
              <button
                disabled={!newName.trim() || creating}
                onClick={handleCreateProject}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4 inline mr-1.5" /> {creating ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          )}
        </div>

        {/* Draft option */}
        <div className="px-8 py-4 border-t border-slate-800/60 bg-slate-900/30">
          <button
            onClick={onDraft}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-all"
          >
            <FileText className="w-3.5 h-3.5" /> Continue as Draft (no project)
          </button>
        </div>
      </div>
    </div>
  );
}
