import { create } from 'zustand';
import {
  createProject as createProjectSynced,
  updateProject as updateProjectSynced,
  getCachedProject,
  fetchProjectById,
  type Project,
  type ProjectCreateInput,
  type SyncStatus,
} from '../features/projects/projectStorage';
import { scopedKey } from '../utils/storage';

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

  // Hydrate active-project metadata from the server when the local cache
  // missed (name is null) — e.g. opening a teammate's same-org project via a
  // deep link. No-op if already populated, offline, or the id is stale.
  hydrateActiveProjectMeta: (id: string) => Promise<void>;

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

// The active project is workbench state: it survives reloads and navigation
// (a full-page reload used to silently drop it, re-opening the gate dialog).
// User-scoped like every other per-user key; scopedKey is boot-order safe.
const ACTIVE_PROJECT_KEY = 'hvac_active_project';

function loadPersistedActiveId(): string | null {
  try {
    return localStorage.getItem(scopedKey(ACTIVE_PROJECT_KEY));
  } catch {
    return null;
  }
}

function persistActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(scopedKey(ACTIVE_PROJECT_KEY), id);
    else localStorage.removeItem(scopedKey(ACTIVE_PROJECT_KEY));
  } catch { /* quota — non-fatal */ }
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

// Restore the last active project on boot — only if it still exists in the
// cached list (a deleted project must not resurrect as a dangling context).
const persistedActiveId = loadPersistedActiveId();
const initialActive: Partial<ProjectState> =
  persistedActiveId && getCachedProject(persistedActiveId)
    ? hydrateFromCache(persistedActiveId)
    : {};

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProjectId: null,
  activeProjectName: null,
  activeProjectType: null,
  activeProjectAddress: null,
  activeProjectSyncStatus: null,
  ...initialActive,

  setActiveProject: (id: string) => {
    persistActiveId(id);
    set(hydrateFromCache(id));
  },

  clearActiveProject: () => {
    persistActiveId(null);
    set({
      activeProjectId: null,
      activeProjectName: null,
      activeProjectType: null,
      activeProjectAddress: null,
      activeProjectSyncStatus: null,
    });
  },

  hydrateActiveProjectMeta: async (id: string) => {
    // Only fetch when the cache miss left us without a name, and only for the
    // still-active id (a late response must not clobber a newer switch).
    if (get().activeProjectId !== id || get().activeProjectName) return;
    const project = await fetchProjectById(id);
    if (!project || get().activeProjectId !== id) return;
    set({
      activeProjectName: project.name,
      activeProjectType: project.type,
      activeProjectAddress: `${project.address}${project.city ? `, ${project.city}` : ''}`,
      activeProjectSyncStatus: project.syncStatus,
    });
  },

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
    persistActiveId(created.id);
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
