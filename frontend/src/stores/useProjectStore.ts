import { create } from 'zustand';
import {
  createProject as createProjectSynced,
  updateProject as updateProjectSynced,
  getCachedProject,
  type Project,
  type ProjectCreateInput,
  type SyncStatus,
} from '../features/projects/projectStorage';

// ── Project Store ─────────────────────────────────────────────────────────────
// Single source of truth for the currently open project's identity.
// Hydrated by CadWorkspace when a project route is loaded. All mutating ops
// route through projectStorage so they sync to D1 with localStorage fallback.

interface ProjectState {
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectType: string | null;
  activeProjectAddress: string | null;
  activeProjectSyncStatus: SyncStatus | null;

  // Set from route + cache lookup
  setActiveProject: (id: string) => void;
  clearActiveProject: () => void;

  // Rename the active project (optimistic local + D1 sync)
  renameProject: (newName: string) => void;

  // Update any project metadata field — optimistic local + D1 sync
  updateProjectDetails: (patch: {
    name?: string;
    type?: string;
    address?: string;
    city?: string;
  }) => void;

  // Create a new project. Awaited so callers can navigate with the real ID.
  // Returns the created project (cloud-backed ID when online, `proj-*` when offline).
  createProject: (details: ProjectCreateInput) => Promise<string>;
}

function hydrateFromCache(
  id: string
): Partial<ProjectState> {
  const project = getCachedProject(id);
  if (!project) {
    return {
      activeProjectId: id,
      activeProjectName: null,
      activeProjectType: null,
      activeProjectAddress: null,
      activeProjectSyncStatus: null,
    };
  }
  return {
    activeProjectId: project.id,
    activeProjectName: project.name,
    activeProjectType: project.type,
    activeProjectAddress: `${project.address}${project.city ? `, ${project.city}` : ''}`,
    activeProjectSyncStatus: project.syncStatus,
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProjectId: null,
  activeProjectName: null,
  activeProjectType: null,
  activeProjectAddress: null,
  activeProjectSyncStatus: null,

  setActiveProject: (id: string) => {
    set(hydrateFromCache(id));
  },

  clearActiveProject: () =>
    set({
      activeProjectId: null,
      activeProjectName: null,
      activeProjectType: null,
      activeProjectAddress: null,
      activeProjectSyncStatus: null,
    }),

  renameProject: (newName: string) => {
    get().updateProjectDetails({ name: newName });
  },

  updateProjectDetails: (patch) => {
    const id = get().activeProjectId;
    if (!id) return;

    // Optimistic in-memory update
    const updates: Partial<ProjectState> = {};
    if (patch.name !== undefined) updates.activeProjectName = patch.name;
    if (patch.type !== undefined) updates.activeProjectType = patch.type;
    if (patch.address !== undefined || patch.city !== undefined) {
      const cached = getCachedProject(id);
      const addr = patch.address ?? cached?.address ?? '';
      const city = patch.city ?? cached?.city ?? '';
      updates.activeProjectAddress = `${addr}${city ? `, ${city}` : ''}`;
    }
    set(updates);

    // Sync to D1 (non-blocking — projectStorage handles local fallback + toasts)
    void updateProjectSynced(id, patch).then((synced) => {
      if (synced && synced.syncStatus !== get().activeProjectSyncStatus) {
        set({ activeProjectSyncStatus: synced.syncStatus });
      }
    });
  },

  createProject: async (details) => {
    const created = await createProjectSynced(details);
    set({
      activeProjectId: created.id,
      activeProjectName: created.name,
      activeProjectType: created.type,
      activeProjectAddress: `${created.address}${created.city ? `, ${created.city}` : ''}`,
      activeProjectSyncStatus: created.syncStatus,
    });
    return created.id;
  },
}));

// Re-export the Project type so other modules can depend on the store without
// reaching into the feature folder directly.
export type { Project };
