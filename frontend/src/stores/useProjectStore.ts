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
}

export const useProjectStore = create<ProjectState>((set) => ({
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
}));
