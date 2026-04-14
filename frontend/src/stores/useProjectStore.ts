import { create } from 'zustand';

// ── Project Store ─────────────────────────────────────────────────────────────
// Single source of truth for the currently open project's identity.
// Hydrated by CadWorkspace when a project route is loaded.

const STORAGE_KEY = 'hvac_projects';

interface Project {
  id: string;
  name: string;
  address: string;
  city: string;
  date: string;
  status: string;
  type: string;
}

interface ProjectState {
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectType: string | null;
  activeProjectAddress: string | null;

  // Set from route + localStorage lookup
  setActiveProject: (id: string) => void;
  clearActiveProject: () => void;

  // Rename the active project (persists to localStorage)
  renameProject: (newName: string) => void;

  // Update any project metadata field (name, type, address) — persists to localStorage
  updateProjectDetails: (patch: { name?: string; type?: string; address?: string; city?: string }) => void;

  // Create a new project from inside CAD and make it active
  createProject: (project: { name: string; type: string; address: string; city: string }) => string;

  // Read-only access to the project list (for selectors/dialogs)
  getProjectList: () => Project[];
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProjectId: null,
  activeProjectName: null,
  activeProjectType: null,
  activeProjectAddress: null,

  setActiveProject: (id: string) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const projects: Project[] = JSON.parse(raw);
        const project = projects.find((p) => p.id === id);
        if (project) {
          set({
            activeProjectId: project.id,
            activeProjectName: project.name,
            activeProjectType: project.type,
            activeProjectAddress: `${project.address}${project.city ? `, ${project.city}` : ''}`,
          });
          return;
        }
      }
    } catch {
      /* localStorage unavailable */
    }
    // Fallback: we have an id but no project record
    set({
      activeProjectId: id,
      activeProjectName: null,
      activeProjectType: null,
      activeProjectAddress: null,
    });
  },

  clearActiveProject: () =>
    set({
      activeProjectId: null,
      activeProjectName: null,
      activeProjectType: null,
      activeProjectAddress: null,
    }),

  renameProject: (newName: string) => {
    get().updateProjectDetails({ name: newName });
  },

  updateProjectDetails: (patch) => {
    const id = get().activeProjectId;
    // Persist changed fields to localStorage project record
    if (id) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const projects: Project[] = JSON.parse(raw);
          const idx = projects.findIndex(p => p.id === id);
          if (idx !== -1) {
            if (patch.name !== undefined) projects[idx].name = patch.name;
            if (patch.type !== undefined) projects[idx].type = patch.type;
            if (patch.address !== undefined) projects[idx].address = patch.address;
            if (patch.city !== undefined) projects[idx].city = patch.city;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
          }
        }
      } catch { /* ignore */ }
    }
    // Update in-memory store
    const updates: Partial<ProjectState> = {};
    if (patch.name !== undefined) updates.activeProjectName = patch.name;
    if (patch.type !== undefined) updates.activeProjectType = patch.type;
    if (patch.address !== undefined || patch.city !== undefined) {
      const addr = patch.address ?? '';
      const city = patch.city ?? '';
      updates.activeProjectAddress = `${addr}${city ? `, ${city}` : ''}`;
    }
    set(updates);
  },

  createProject: (details) => {
    const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const project: Project = {
      id,
      name: details.name,
      type: details.type,
      address: details.address,
      city: details.city,
      date: new Date().toISOString(),
      status: 'In Progress',
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const projects: Project[] = raw ? JSON.parse(raw) : [];
      projects.unshift(project);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch { /* ignore */ }
    set({
      activeProjectId: id,
      activeProjectName: project.name,
      activeProjectType: project.type,
      activeProjectAddress: `${project.address}${project.city ? `, ${project.city}` : ''}`,
    });
    return id;
  },

  getProjectList: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },
}));
