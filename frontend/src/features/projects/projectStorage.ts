/**
 * Project persistence — online/offline sync layer.
 *
 * Responsibilities:
 *  - Create / list / update / delete projects against D1 via api.ts
 *  - Fall back to localStorage when offline, unauthenticated, or when the
 *    Workers API is unreachable
 *  - Merge local-only projects (legacy `proj-*` IDs) with D1-backed ones
 *    so nothing silently disappears when the user goes online/offline
 *  - Expose a migration helper that promotes a `proj-*` project to D1 and
 *    carries its CAD drawing + calculations with it
 *
 * Storage shape (localStorage, user-scoped via scopedKey):
 *   hvac_projects → Project[]  (canonical list — D1 + local merged)
 *
 * A Project carries a `syncStatus` flag so the UI can render:
 *   'synced'     — backed by D1
 *   'local_only' — lives in localStorage only (offline, anon, or legacy)
 *   'pending'    — optimistic local copy, sync in flight
 *   'error'      — last sync attempt failed; will retry
 */

import { api } from '../../lib/api';
import { scopedKey } from '../../utils/storage';
import { toast } from '../../stores/useToastStore';

export type SyncStatus = 'synced' | 'local_only' | 'pending' | 'error';

export interface Project {
  id: string;
  name: string;
  type: string;              // 'Residential' | 'Commercial' | 'Municipal' | ...
  address: string;
  city: string;
  state?: string;
  zip?: string;
  climateZone?: string;
  standard?: string;         // 'ACCA' | 'ASHRAE' | 'EN' | 'CSA'
  status: string;            // display: "In Progress" | "Complete" | ...
  date: string;              // ISO created_at
  updatedAt?: string;        // ISO updated_at (D1 only)
  syncStatus: SyncStatus;
  // Community sharing — set when the owner posts the project to /community.
  // Optimistically updated by the Dashboard share modal; authoritative
  // copy lives in D1 (`projects.is_public`). The summary is owner-curated
  // text shown on the public listing instead of raw address/client name.
  isPublic?: boolean;
  shareSummary?: string;
}

export interface ProjectCreateInput {
  name: string;
  type: string;
  address: string;
  city: string;
  state?: string;
  zip?: string;
  climateZone?: string;
  standard?: string;
}

const STORAGE_KEY = 'hvac_projects';

const isLocalId = (id: string) => id.startsWith('proj-');
const newLocalId = () =>
  `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// ── Local cache ──────────────────────────────────────────────────────────────

function readCache(): Project[] {
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_KEY));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Backfill syncStatus for any pre-migration entries
    return arr.map((p) => ({
      syncStatus: (p.syncStatus as SyncStatus) ?? (isLocalId(p.id) ? 'local_only' : 'synced'),
      ...p,
    }));
  } catch {
    return [];
  }
}

function writeCache(projects: Project[]): void {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(projects));
  } catch { /* quota exceeded — silent */ }
}

// ── Backend ⇄ frontend mapping ───────────────────────────────────────────────

interface BackendProject {
  id: string;
  name: string;
  project_type?: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  climate_zone?: string | null;
  standard?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
  // Migration 0004 (team_and_forum) — community-sharing fields. Older
  // backend builds may not return these; treat as falsy when absent.
  is_public?: number | boolean;
  share_summary?: string | null;
}

function fromBackend(p: BackendProject): Project {
  return {
    id: p.id,
    name: p.name,
    type: p.project_type || 'Residential',
    address: p.address || '',
    city: p.city || '',
    state: p.state || undefined,
    zip: p.zip || undefined,
    climateZone: p.climate_zone || undefined,
    standard: p.standard || 'ACCA',
    status: p.status === 'archived' ? 'Archived' : 'In Progress',
    date: p.created_at || new Date().toISOString(),
    updatedAt: p.updated_at,
    syncStatus: 'synced',
    isPublic: p.is_public === 1 || p.is_public === true,
    shareSummary: p.share_summary || undefined,
  };
}

function toBackendBody(input: ProjectCreateInput): {
  name: string;
  projectType: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  climateZone?: string;
  standard?: string;
} {
  return {
    name: input.name,
    projectType: input.type,
    address: input.address || undefined,
    city: input.city || undefined,
    state: input.state || undefined,
    zip: input.zip || undefined,
    climateZone: input.climateZone || undefined,
    standard: input.standard || 'ACCA',
  };
}

// ── Auth gate ────────────────────────────────────────────────────────────────

function isAuthenticated(): boolean {
  // api.getToken reads from localStorage lazily
  return Boolean(api.getToken());
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the project list. Backend-first when online + authenticated,
 * with local fallback. Returns a merged list: D1-backed projects
 * override any cached copy; legacy `proj-*` projects are preserved
 * as `local_only` until the user migrates them.
 */
export async function loadProjects(): Promise<Project[]> {
  const local = readCache();

  if (!isAuthenticated()) {
    return local;
  }

  try {
    const { projects: remote } = await api.listProjects();
    const mapped = (remote as BackendProject[]).map(fromBackend);

    // Preserve any `proj-*` local-only projects that D1 doesn't know about
    const remoteIds = new Set(mapped.map((p) => p.id));
    const orphans = local.filter((p) => isLocalId(p.id) && !remoteIds.has(p.id));

    const merged = [...mapped, ...orphans];
    writeCache(merged);
    return merged;
  } catch (err) {
    // Offline, 5xx, etc. — surface local only. api.ts already toasted.
    console.warn('[projectStorage] list failed, using local cache', err);
    return local;
  }
}

/**
 * Create a new project. Tries D1 first; on failure (offline, 5xx), falls
 * back to a local `proj-*` record that can be migrated later.
 */
export async function createProject(
  input: ProjectCreateInput
): Promise<Project> {
  const cache = readCache();
  const nowIso = new Date().toISOString();

  // Offline / anon fallback — pure local
  if (!isAuthenticated()) {
    const local: Project = {
      id: newLocalId(),
      name: input.name,
      type: input.type,
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip,
      climateZone: input.climateZone,
      standard: input.standard || 'ACCA',
      status: 'In Progress',
      date: nowIso,
      syncStatus: 'local_only',
    };
    writeCache([local, ...cache]);
    return local;
  }

  try {
    const { project: remote } = await api.createProject(toBackendBody(input));
    const created = fromBackend(remote as BackendProject);
    writeCache([created, ...cache]);
    return created;
  } catch (err) {
    console.warn('[projectStorage] create sync failed, saving local-only', err);
    toast.warning('Saved locally — cloud sync unavailable.');
    const local: Project = {
      id: newLocalId(),
      name: input.name,
      type: input.type,
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip,
      climateZone: input.climateZone,
      standard: input.standard || 'ACCA',
      status: 'In Progress',
      date: nowIso,
      syncStatus: 'local_only',
    };
    writeCache([local, ...cache]);
    return local;
  }
}

/**
 * Partial update. Syncs to D1 when possible; updates cache unconditionally.
 */
export async function updateProject(
  id: string,
  patch: Partial<ProjectCreateInput & { status: string }>
): Promise<Project | null> {
  const cache = readCache();
  const idx = cache.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  // Optimistic local update
  const merged: Project = { ...cache[idx], ...patch, syncStatus: cache[idx].syncStatus };
  cache[idx] = merged;
  writeCache(cache);

  if (isLocalId(id) || !isAuthenticated()) {
    return merged;
  }

  try {
    const { project: remote } = await api.updateProject(id, {
      name: patch.name,
      address: patch.address,
      city: patch.city,
      state: patch.state,
      zip: patch.zip,
      climateZone: patch.climateZone,
      standard: patch.standard,
      projectType: patch.type,
      status: patch.status,
    });
    const synced = fromBackend(remote as BackendProject);
    cache[idx] = synced;
    writeCache(cache);
    return synced;
  } catch (err) {
    console.warn('[projectStorage] update sync failed', err);
    cache[idx] = { ...merged, syncStatus: 'error' };
    writeCache(cache);
    return cache[idx];
  }
}

/**
 * Delete a project. Remote-first for D1-backed projects: the local cache
 * entry is only purged once the server confirms, so a failed remote delete
 * can't leave a "zombie" that vanishes from the UI but resurrects from D1
 * on the next load. Returns false when the remote delete failed — the
 * caller should restore its optimistic UI state. Never throws.
 */
export async function deleteProject(id: string): Promise<boolean> {
  if (!isLocalId(id) && isAuthenticated()) {
    try {
      await api.deleteProject(id);
    } catch (err) {
      console.warn('[projectStorage] remote delete failed (local kept)', err);
      return false;
    }
  }

  const cache = readCache();
  writeCache(cache.filter((p) => p.id !== id));
  return true;
}

/**
 * Promote a `proj-*` local-only project to D1, returning the new cloud-
 * backed record. The old local ID is swapped for the D1 UUID in the cache.
 *
 * Note: this does NOT migrate attached CAD drawings or calculations — those
 * are keyed by the same localStorage pattern (`hvac_cad_{id}`) and would
 * need a follow-up pass to re-key and POST. For now, a migrated project
 * keeps its current CAD drawing in localStorage under the OLD key; on next
 * save, the CAD auto-save path will pick up the new ID and start syncing
 * fresh drawings to D1. Deep CAD/calc migration lands in a follow-up unit.
 */
export async function migrateLocalProjectToCloud(
  localId: string
): Promise<Project | null> {
  if (!isLocalId(localId) || !isAuthenticated()) return null;
  const cache = readCache();
  const existing = cache.find((p) => p.id === localId);
  if (!existing) return null;

  try {
    const { project: remote } = await api.createProject(
      toBackendBody({
        name: existing.name,
        type: existing.type,
        address: existing.address,
        city: existing.city,
        state: existing.state,
        zip: existing.zip,
        climateZone: existing.climateZone,
        standard: existing.standard,
      })
    );
    const synced = fromBackend(remote as BackendProject);

    // Swap the old entry out, preserving list order
    const next = cache.map((p) => (p.id === localId ? synced : p));
    writeCache(next);

    // Carry any CAD drawing keyed by the old ID over to the new ID in
    // localStorage so the CAD canvas reloads after navigation.
    try {
      const oldCadKey = scopedKey(`hvac_cad_${localId}`);
      const newCadKey = scopedKey(`hvac_cad_${synced.id}`);
      const cad = localStorage.getItem(oldCadKey);
      if (cad) {
        localStorage.setItem(newCadKey, cad);
        localStorage.removeItem(oldCadKey);
      }
    } catch { /* ignore */ }

    toast.success(`"${synced.name}" is now synced to the cloud.`);
    return synced;
  } catch (err) {
    console.warn('[projectStorage] migrate failed', err);
    toast.error('Could not sync to cloud. Try again later.');
    return null;
  }
}

/**
 * Read the cached project list synchronously (for initial UI paint before
 * the async load resolves).
 */
export function getCachedProjects(): Project[] {
  return readCache();
}

/**
 * Read a single cached project by id (sync).
 */
export function getCachedProject(id: string): Project | null {
  return readCache().find((p) => p.id === id) ?? null;
}

/**
 * Fetch a single project by id from D1 and upsert it into the local cache.
 * Hydrates metadata for a project the current session CAN see but that isn't
 * in the cached list yet — e.g. a teammate's same-org project opened via a
 * deep link or an audit-log drill-through. Returns null when unauthenticated,
 * offline, local-only, or the project isn't visible to this org (404) — the
 * caller decides whether that's an honest "no access" or a silent skip.
 */
export async function fetchProjectById(id: string): Promise<Project | null> {
  if (isLocalId(id) || !isAuthenticated()) return null;
  try {
    const { project: remote } = await api.getProject(id);
    const mapped = fromBackend(remote as BackendProject);
    const cache = readCache();
    const idx = cache.findIndex((p) => p.id === id);
    if (idx === -1) cache.unshift(mapped);
    else cache[idx] = mapped;
    writeCache(cache);
    return mapped;
  } catch (err) {
    console.warn('[projectStorage] fetchProjectById failed', err);
    return null;
  }
}

export const __storageKey = STORAGE_KEY;
