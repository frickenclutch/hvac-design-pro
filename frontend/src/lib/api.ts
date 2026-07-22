import { toast } from '../stores/useToastStore';
import type { User, Organisation } from '../features/auth/store/useAuthStore';

// API base URL — set VITE_API_BASE_URL in environment (Cloudflare Pages / .env.local)
// When unset, API calls go to same origin (Pages functions or local dev proxy)
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ── Audit log types — exported so pages and tabs can share them ──────────
export interface AuditEvent {
  id: string;
  createdAt: string;
  action: string;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  actor: {
    userId: string | null;
    orgId: string | null;
    role: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    orgName: string | null;
    isPlatformAction: boolean;
  };
  target: { orgId: string | null; orgName: string | null };
  entity: {
    type: string | null;
    id: string | null;
    label: string | null;
    projectId: string | null;
  };
  detail: unknown;
  beforeValue: unknown;
  afterValue: unknown;
  network: { ip: string | null; userAgent: string | null; requestId: string | null };
}

export interface AuditLogQuery {
  scope?: 'platform' | 'tenant';
  userId?: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  action?: string;
  orgId?: string;
  since?: string;
  limit?: number;
  cursor?: string;
}

// ── Server response row shapes ───────────────────────────────────────────
// These mirror the columns each Worker route SELECTs — snake_case, straight
// from D1 — NOT the camelCase frontend domain models (those live in the
// stores). Opaque JSON payloads (canvas state, calc inputs/outputs) are
// typed `unknown`: callers that need the inner shape narrow at the point of
// use rather than the client pretending to know it.

export interface ApiProjectRow {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  climate_zone: string | null;
  standard: string | null;
  project_type: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Present on the list query (LEFT JOIN users); absent on single-row reads. */
  creator_name?: string | null;
  /** Migration 0004 community-sharing fields; absent on older backend builds. */
  is_public?: number | boolean;
  share_summary?: string | null;
}

export interface ApiCalculationRow {
  id: string;
  project_id: string;
  org_id: string;
  calc_type: string;
  version: number;
  inputs: string;            // JSON string exactly as stored in D1
  outputs: string | null;    // JSON string exactly as stored in D1
  status: string;
  engine_version: string;
  computed_by: string | null;
  computed_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

/** getCalculation parses inputs/outputs before returning them. */
export interface ApiCalculationDetail extends Omit<ApiCalculationRow, 'inputs' | 'outputs'> {
  inputs: unknown;
  outputs: unknown;
}

// Logarithmic Extraction Tool (LET) — the structured proposal the Worker's
// Claude vision endpoint returns. Mirrors workers/src/routes/ai.ts EXTRACTION_SCHEMA.
export interface AiExtractedRoom {
  name: string;
  lengthFt: number;
  widthFt: number;
  ceilingHeightFt?: number;
  windowCount?: number;
  exposureDirection?: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  confidence: 'high' | 'medium' | 'low';
  /** Room boundary traced on the sheet — normalized [0,1] coords, y down. */
  polygon?: Array<{ x: number; y: number }>;
  /** 0-based index of the sheet the polygon was traced on (default 0). */
  imageIndex?: number;
  notes?: string;
}

export interface AiBlueprintExtraction {
  buildingType: 'residential' | 'commercial' | 'unknown';
  rooms: AiExtractedRoom[];
  scaleNote?: string;
  warnings: string[];
}

export interface ApiFileRow {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  purpose: string;
  created_at: string;
}

export interface ApiDrawingSummary {
  id: string;
  name: string;
  floor_index: number;
  thumbnail_key: string | null;
  created_at: string;
  updated_at: string;
}

/** getDrawing returns the full cad_drawings row plus the parsed canvas. */
export interface ApiDrawingDetail {
  id: string;
  project_id: string;
  org_id: string;
  name: string;
  floor_index: number;
  canvas_json: string;
  thumbnail_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  canvasJson: unknown;
}

export interface UpdateProjectInput {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  climateZone?: string;
  standard?: string;
  projectType?: string;
  status?: string;
}

// ── Catalog / Product Inventory (org-owned) ──────────────────────────────────
export type CatalogCategory = 'hvac_equipment' | 'water_heater' | 'pipe_fitting' | 'other';
export type CatalogEquipmentType = 'ac' | 'heat_pump' | 'furnace_gas' | 'furnace_electric';

/** A catalog_products row as returned by GET /api/catalog. Snake_case mirrors
 *  the D1 column names. price_minor is in minor units (e.g. cents). The
 *  equipment_* / *_btu / afue fields are populated only for hvac_equipment. */
export interface ApiCatalogProductRow {
  id: string;
  org_id: string;
  category: CatalogCategory;
  sku: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  price_minor: number; // minor units (e.g. cents)
  currency: string;
  stock_qty: number;
  unit: string;
  active: number; // 0 | 1
  metadata: string | null; // JSON string
  equipment_type: CatalogEquipmentType | null;
  total_cooling_btu: number | null;
  sensible_cooling_btu: number | null;
  ahri_ref: string | null;
  heating_btu: number | null;
  heating_cap_47: number | null;
  heating_cap_17: number | null;
  afue: number | null;
  created_at: string;
  updated_at: string;
}

/** One item in a bulk-upsert push (POST /api/catalog/items). camelCase — the
 *  server maps these onto the snake_case columns. Idempotent on (org, sku). */
export interface BulkCatalogItemInput {
  sku: string;
  name: string;
  category?: CatalogCategory;
  brand?: string;
  model?: string;
  description?: string;
  priceMinor?: number;
  currency?: string;
  stockQty?: number;
  unit?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
  equipmentType?: CatalogEquipmentType;
  totalCoolingBtu?: number;
  sensibleCoolingBtu?: number;
  ahriRef?: string;
  heatingBtu?: number;
  heatingCap47?: number;
  heatingCap17?: number;
  afue?: number;
}

const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Outcome of a silent refresh rotation.
 *  'ok'        — fresh pair in hand (rotated here, or adopted from another tab)
 *  'rejected'  — the server definitively refused the refresh token; the
 *                session is dead and credentials should be torn down
 *  'transient' — the refresh endpoint was unreachable or 5xx'd; the stored
 *                refresh token is still perfectly valid and MUST NOT be
 *                discarded — surface a connection error, not a logout
 */
export type RefreshOutcome = 'ok' | 'rejected' | 'transient';

class ApiClient {
  private token: string | null = null;
  private refreshInFlight: Promise<RefreshOutcome> | null = null;
  private sessionExpiredHandler: (() => void) | null = null;
  private sessionExpiredNotified = false;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('hvac_session_token', token);
      this.sessionExpiredNotified = false;
    } else {
      // Clearing the access token tears down the whole credential set.
      localStorage.removeItem('hvac_session_token');
      localStorage.removeItem('hvac_refresh_token');
    }
  }

  /** Persist a freshly-issued access + refresh pair (login or rotation). */
  setTokens(accessToken: string, refreshToken: string) {
    this.token = accessToken;
    localStorage.setItem('hvac_session_token', accessToken);
    localStorage.setItem('hvac_refresh_token', refreshToken);
    this.sessionExpiredNotified = false;
  }

  /** Registered by the auth store. A terminal 401 flips the app to the
   *  logged-out state exactly once (the route guard then redirects to the
   *  login surface) instead of leaving a zombie authenticated UI where
   *  every click re-toasts "Session expired". */
  onSessionExpired(handler: () => void) {
    this.sessionExpiredHandler = handler;
  }

  private sessionExpired() {
    this.setToken(null);
    const onPublicSurface =
      window.location.pathname.includes('/login') || window.location.pathname === '/';
    if (!this.sessionExpiredNotified && !onPublicSurface) {
      this.sessionExpiredNotified = true;
      toast.error('Session expired. Please sign in again.');
    }
    this.sessionExpiredHandler?.();
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('hvac_session_token');
    }
    return this.token;
  }

  getRefreshToken(): string | null {
    return localStorage.getItem('hvac_refresh_token');
  }

  /**
   * Exchange the stored refresh token for a fresh access + refresh pair.
   * Concurrent callers in THIS tab share one in-flight rotation; a Web Lock
   * serializes rotation across OTHER tabs sharing this localStorage, and a
   * tab that lost the race adopts the winner's freshly-written pair instead
   * of replaying a consumed token (which would trip the server's theft
   * detection and revoke the whole set — the "session expired in both
   * windows" failure). Transient network/5xx failures are retried and never
   * destroy the stored refresh token.
   */
  async refreshSession(): Promise<RefreshOutcome> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.runExclusiveRefresh();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async runExclusiveRefresh(): Promise<RefreshOutcome> {
    const seen = this.getRefreshToken();
    if (!seen) return 'rejected';

    const rotate = async (): Promise<RefreshOutcome> => {
      // Re-read AFTER acquiring the lock — another tab may have already
      // rotated while we waited. If so, adopt its pair and skip the network.
      const current = localStorage.getItem('hvac_refresh_token');
      if (!current) return 'rejected';
      if (current !== seen) {
        this.token = localStorage.getItem('hvac_session_token');
        return this.token ? 'ok' : 'rejected';
      }
      return this.rotateRefreshToken(current);
    };

    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('hvac_refresh_rotation', rotate);
    }
    return rotate();
  }

  private async rotateRefreshToken(refreshToken: string): Promise<RefreshOutcome> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (res.status >= 500) throw new Error(`refresh ${res.status}`);
        if (!res.ok) {
          // Before declaring the session dead, check whether another tab
          // rotated while our request was in flight (no-Web-Locks fallback):
          // if the stored refresh token changed, adopt the winner's pair.
          const current = localStorage.getItem('hvac_refresh_token');
          if (current && current !== refreshToken) {
            this.token = localStorage.getItem('hvac_session_token');
            if (this.token) return 'ok';
          }
          return 'rejected'; // 4xx — definitive server refusal
        }
        const data = await res.json() as { token?: string; refreshToken?: string };
        if (!data.token || !data.refreshToken) return 'rejected';
        this.setTokens(data.token, data.refreshToken);
        return 'ok';
      } catch {
        if (attempt < MAX_RETRIES) await sleep(500 * Math.pow(2, attempt));
      }
    }
    return 'transient';
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let lastError: Error | null = null;
    let triedRefresh = false;
    // Auth endpoints 401 for their own reasons (bad password, consumed
    // one-time token) — never treat that as session death. The MFA
    // *management* endpoints are the exception: they run behind the normal
    // bearer session, so they get standard silent-refresh semantics.
    const isAuthPath = path.startsWith('/api/auth/') && !path.startsWith('/api/auth/mfa/');

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Build headers fresh each iteration so a silent refresh's rotated
      // access token is picked up on the retry.
      const token = this.getToken();
      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string> || {}),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      // Don't set Content-Type for FormData (browser sets it with boundary)
      if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }

      try {
        const res = await fetch(`${API_BASE}${path}`, {
          ...options,
          headers,
        });

        // 401 — try one silent token refresh + retry, then end the session.
        if (res.status === 401) {
          if (isAuthPath) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            const msg = body.error || 'Authentication failed';
            toast.error(msg);
            throw new Error(msg);
          }
          if (!triedRefresh) {
            triedRefresh = true;
            const outcome = await this.refreshSession();
            if (outcome === 'ok') continue; // retry with the rotated access token
            if (outcome === 'transient') {
              // The refresh endpoint was unreachable — the session is very
              // likely still valid. Surface a connection error and leave
              // the stored credentials alone.
              toast.error('Unable to reach the server. Please check your connection.');
              throw new Error('Unable to reach the server. Please check your connection.');
            }
          }
          this.sessionExpired();
          throw new Error('Session expired');
        }

        // 4xx — client error, no retry
        if (res.status >= 400 && res.status < 500) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          const msg = body.error || 'Request failed';
          toast.error(msg);
          throw new Error(msg);
        }

        // 5xx — server error, retry if attempts remain
        if (res.status >= 500) {
          lastError = new Error(`Server error (${res.status})`);
          if (attempt < MAX_RETRIES) {
            if (attempt === 0) toast.warning('Connection issue, retrying...');
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }
          toast.error('Server error. Please try again in a moment.');
          throw lastError;
        }

        return await res.json() as T;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        // If it's our own thrown error (401, 4xx, or final 5xx), re-throw.
        // Only a genuine network failure ('Failed to fetch') falls through
        // to the retry path below.
        if (error === lastError || error.message === 'Session expired' || error.message !== 'Failed to fetch') {
          throw error;
        }

        // Network error — retry if attempts remain
        lastError = error;
        if (attempt < MAX_RETRIES) {
          if (attempt === 0) toast.warning('Connection issue, retrying...');
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }

        toast.error('Unable to reach the server. Please check your connection.');
        throw new Error('Unable to reach the server. Please check your connection.');
      }
    }

    // Unreachable, but TypeScript needs it
    throw lastError ?? new Error('Request failed');
  }

  // Auth
  async register(data: { email: string; password: string; firstName: string; lastName: string; orgName?: string; orgType?: string; regionCode?: string }) {
    return this.request<{ token: string; user: User; organisation: Organisation }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(email: string, password: string) {
    return this.request<{ token: string; user: User; organisation: Organisation }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } finally {
      this.setToken(null);
    }
  }

  async getMe() {
    return this.request<{ user: User; organisation: Organisation }>('/api/auth/me');
  }

  // ── MFA (TOTP) — AUTHED management of the session user's own factor ───────
  // These four go through request<T>() so the Bearer + 401-silent-refresh +
  // toast handling come free. The PRE-SESSION challenge/grace calls do NOT live
  // here — they go through the auth store's own apiFetch (no auto-refresh),
  // mirroring how login/verifyEmail are implemented.
  async mfaStatus() {
    return this.request<{
      enabled: boolean;
      method: 'totp' | null;
      required: boolean;
      backupCodesRemaining: number;
    }>('/api/auth/mfa/status');
  }

  async mfaEnrollStart() {
    return this.request<{ secret: string; otpauthUri: string }>('/api/auth/mfa/enroll', {
      method: 'POST',
    });
  }

  async mfaConfirm(code: string) {
    return this.request<{ enabled: boolean; backupCodes: string[] }>('/api/auth/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async mfaDisable(code: string) {
    return this.request<{ enabled: boolean }>('/api/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  // Projects
  async listProjects() {
    return this.request<{ projects: ApiProjectRow[] }>('/api/projects');
  }

  async getProject(id: string) {
    return this.request<{ project: ApiProjectRow }>(`/api/projects/${id}`);
  }

  async createProject(data: { name: string; address?: string; city?: string; state?: string; zip?: string; climateZone?: string; standard?: string }) {
    return this.request<{ project: ApiProjectRow }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProject(id: string, data: UpdateProjectInput) {
    return this.request<{ project: ApiProjectRow }>(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id: string) {
    return this.request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' });
  }

  // Calculations
  async listCalculations(projectId: string) {
    return this.request<{ calculations: ApiCalculationRow[] }>(`/api/calculations/project/${projectId}`);
  }

  async saveCalculation(data: { projectId: string; calcType: string; inputs: unknown; outputs: unknown; engineVersion?: string; durationMs?: number }) {
    return this.request<{ id: string; version: number }>('/api/calculations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getCalculation(id: string) {
    return this.request<ApiCalculationDetail>(`/api/calculations/${id}`);
  }

  // Logarithmic Extraction (Worker → Claude vision). Accepts a whole plan
  // set (up to 6 sheets) and returns ONE merged room schedule. Every result
  // is a PROPOSAL — the UI requires human review before anything becomes
  // calc input.
  async extractBlueprint(imageDataUrls: string[], projectId?: string, fileName?: string) {
    return this.request<{
      extraction: AiBlueprintExtraction;
      engine: string;
      usage: { inputTokens: number; outputTokens: number };
    }>('/api/ai/blueprint-extract', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrls, projectId, fileName }),
    });
  }

  // File uploads (R2)
  async uploadFile(file: File, purpose: string = 'attachment', projectId?: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', purpose);
    if (projectId) formData.append('projectId', projectId);

    return this.request<{ id: string; r2Key: string; filename: string; contentType: string; sizeBytes: number }>('/api/uploads', {
      method: 'POST',
      body: formData,
    });
  }

  async getFileUrl(id: string): Promise<string> {
    const token = this.getToken();
    return `${API_BASE}/api/uploads/${id}${token ? `?token=${token}` : ''}`;
  }

  // Avatar (own account) — sets/removes users.avatar_key + the R2 object. The
  // public read counterpart is GET /avatars/:id (see utils/avatar.ts).
  async uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request<{ avatarKey: string }>('/api/users/me/avatar', {
      method: 'POST',
      body: formData,
    });
  }

  async deleteAvatar() {
    return this.request<{ ok: boolean }>('/api/users/me/avatar', { method: 'DELETE' });
  }

  async listProjectFiles(projectId: string) {
    return this.request<{ files: ApiFileRow[] }>(`/api/uploads/project/${projectId}`);
  }

  async deleteFile(id: string) {
    return this.request<{ ok: boolean }>(`/api/uploads/${id}`, { method: 'DELETE' });
  }

  // CAD drawings
  async listDrawings(projectId: string) {
    return this.request<{ drawings: ApiDrawingSummary[] }>(`/api/cad/project/${projectId}`);
  }

  async getDrawing(id: string) {
    return this.request<ApiDrawingDetail>(`/api/cad/${id}`);
  }

  async saveDrawing(data: { projectId: string; name?: string; floorIndex?: number; canvasJson: unknown; thumbnailDataUrl?: string }) {
    return this.request<{ id: string; versionNumber?: number }>('/api/cad', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDrawing(id: string, data: { canvasJson: unknown; name?: string; thumbnailDataUrl?: string }) {
    return this.request<{ ok: boolean; versionNumber?: number; audited?: boolean }>(`/api/cad/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDrawing(id: string) {
    return this.request<{ ok: boolean }>(`/api/cad/${id}`, { method: 'DELETE' });
  }

  // ── CAD drawing version history ─────────────────────────────────────────
  // Every save (POST/PUT) appends a snapshot to cad_drawing_versions.
  // This is the forensic-recall side-channel that complements the
  // throttled audit log: full canvas state, every save, append-only.
  async listDrawingVersions(drawingId: string, limit = 100) {
    return this.request<{
      drawingId: string;
      limit: number;
      versions: Array<{
        id: string;
        version_number: number;
        size_bytes: number;
        thumbnail_key: string | null;
        author_user_id: string | null;
        author_first_name: string | null;
        author_last_name: string | null;
        author_email: string | null;
        created_at: string;
      }>;
    }>(`/api/cad/${encodeURIComponent(drawingId)}/versions?limit=${limit}`);
  }

  async getDrawingVersion(versionId: string) {
    return this.request<{
      id: string;
      drawing_id: string;
      project_id: string;
      org_id: string;
      version_number: number;
      size_bytes: number;
      author_user_id: string | null;
      author_first_name: string | null;
      author_last_name: string | null;
      author_email: string | null;
      created_at: string;
      canvasJson: unknown;
    }>(`/api/cad/versions/${encodeURIComponent(versionId)}`);
  }

  async restoreDrawingVersion(versionId: string) {
    return this.request<{
      ok: true;
      drawingId: string;
      versionNumber: number;
      versionId: string;
    }>(`/api/cad/versions/${encodeURIComponent(versionId)}/restore`, {
      method: 'POST',
    });
  }

  // ── Platform admin (L0 creator layer) ───────────────────────────────────
  // All routes here require is_platform_admin = 1 in D1 + a valid session.
  // 403 on call means the session user is not a platform admin.
  async platformMe() {
    return this.request<{
      id: string;
      email: string;
      role: string;
      isPlatformAdmin: boolean;
      orgId: string;
    }>('/api/platform/me');
  }

  async platformMetrics() {
    return this.request<{
      totals: Record<string, number>;
      recent: Record<string, number>;
      breakdown: { orgTypes: Array<{ org_type: string; count: number }>; planTiers: Array<{ plan: string; count: number }> };
      generatedAt: string;
    }>('/api/platform/metrics');
  }

  async platformOrgs() {
    return this.request<{
      organisations: Array<{
        id: string;
        slug: string;
        name: string;
        org_type: string;
        plan: string;
        seats_limit: number;
        billing_status: string;
        region_code: string;
        created_at: string;
        user_count: number;
        project_count: number;
        last_active_at: string | null;
      }>;
    }>('/api/platform/orgs');
  }

  async platformOrgDetail(id: string) {
    return this.request<{
      organisation: Record<string, unknown>;
      users: Array<Record<string, unknown>>;
      counts: Record<string, number>;
    }>(`/api/platform/orgs/${id}`);
  }

  async platformAudit(limit = 100) {
    return this.request<{
      events: Array<Record<string, unknown>>;
      limit: number;
    }>(`/api/platform/audit?limit=${limit}`);
  }

  // ── Access policy (per-tenant compliance gating) ────────────────────────
  // Defaults implement "Option C": versionView=viewer (all), versionRestore
  // =admin, auditView=admin. Tenant admin or L0 can change thresholds.
  async getAccessPolicy() {
    return this.request<{
      policy: { versionView: string; versionRestore: string; auditView: string };
      capabilities: {
        canViewVersions: boolean;
        canRestoreVersions: boolean;
        canViewAudit: boolean;
        canEditPolicy: boolean;
      };
    }>('/api/org/access-policy');
  }

  async setAccessPolicy(patch: {
    versionView?: 'viewer' | 'tech' | 'engineer' | 'admin';
    versionRestore?: 'viewer' | 'tech' | 'engineer' | 'admin';
    auditView?: 'viewer' | 'tech' | 'engineer' | 'admin';
  }) {
    return this.request<{
      policy: { versionView: string; versionRestore: string; auditView: string };
      capabilities: {
        canViewVersions: boolean;
        canRestoreVersions: boolean;
        canViewAudit: boolean;
        canEditPolicy: boolean;
      };
    }>('/api/org/access-policy', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  // ── L0 cross-tenant user management ─────────────────────────────────────
  // PATCH role and/or authority flag on a user inside any tenant. Server
  // gates on isPlatformAdmin and writes audit rows with target_org_id +
  // is_platform_action=1 so the action surfaces in BOTH the L0 audit feed
  // AND the affected tenant's tenant-scoped feed.
  async platformUpdateUser(orgId: string, userId: string, body: { role?: 'admin' | 'engineer' | 'tech' | 'viewer'; isPermitAuthority?: boolean }) {
    return this.request<{ ok: true; role: string; isPermitAuthority: boolean }>(
      `/api/platform/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  }

  async platformRemoveUser(orgId: string, userId: string) {
    return this.request<{ ok: true }>(
      `/api/platform/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  }

  // ── Feedback inbox (L0) — read side of the Mason feedback loop ─────────────
  async platformFeedback(params: { type?: string; status?: string; limit?: number; cursor?: string } = {}) {
    const q = new URLSearchParams();
    if (params.type) q.set('type', params.type);
    if (params.status) q.set('status', params.status);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    return this.request<{
      feedback: Array<{
        id: string;
        type: 'bug' | 'suggestion' | 'question';
        status: 'open' | 'in_progress' | 'resolved' | 'closed';
        text: string;
        context: string | null;
        user_agent: string | null;
        created_at: string;
        org_id: string;
        org_name: string;
        first_name: string | null;
        last_name: string | null;
        user_email: string;
        user_role: string;
        attachment_count: number;
      }>;
      nextCursor: string | null;
      counts: { total: number; open: number; bugs: number; ideas: number; questions: number };
    }>(`/api/platform/feedback${qs ? `?${qs}` : ''}`);
  }

  async platformFeedbackDetail(id: string) {
    return this.request<{
      feedback: Record<string, unknown>;
      attachments: Array<{ id: string; filename: string; content_type: string | null; size_bytes: number | null; dataUrl: string | null }>;
    }>(`/api/platform/feedback/${encodeURIComponent(id)}`);
  }

  async platformUpdateFeedback(id: string, status: string) {
    return this.request<{ ok: true; status: string }>(
      `/api/platform/feedback/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    );
  }

  // ── Per-tenant usage (L0) — cost-bearing + activity meters per org ─────────
  async platformUsage() {
    return this.request<{
      tenants: Array<{
        org_id: string;
        org_name: string;
        plan: string;
        billing_status: string;
        org_type: string;
        seats: number;
        projects: number;
        drawings: number;
        calcs: number;
        calcs_30d: number;
        ai_calls: number;
        ai_calls_30d: number;
        ai_input_tokens: number;
        ai_output_tokens: number;
        storage_files: number;
        storage_bytes: number;
      }>;
      generatedAt: string;
    }>('/api/platform/usage');
  }

  // ── L0 org impersonation ────────────────────────────────────────────────
  // Mints a 30-minute, access-only, READ-ONLY session scoped to the target
  // tenant. The auth store stashes the admin's real pair and swaps this
  // token in; exit (or TTL expiry) swaps back.
  async platformImpersonateOrg(orgId: string) {
    return this.request<{
      token: string;
      expiresAt: string;
      organisation: { id: string; name: string; type: string; slug: string; regionCode: string };
    }>(`/api/platform/orgs/${encodeURIComponent(orgId)}/impersonate`, { method: 'POST' });
  }

  /** Kills ONLY the current impersonation session row server-side.
   *  Deliberately not /api/auth/logout — that revokes the admin's whole
   *  refresh chain, including the stashed real session. */
  async platformExitImpersonation() {
    return this.request<{ ok: true }>('/api/platform/impersonation/exit', { method: 'POST' });
  }

  // ── Audit log ────────────────────────────────────────────────────────────
  // Tenant scope: admins see org-wide feed (own + target_org_id), non-admins
  // see only their own. Pass scope='platform' to get the cross-tenant view
  // (server checks isPlatformAdmin and falls through to tenant scope if not).
  auditLog(opts: AuditLogQuery = {}) {
    const qs = new URLSearchParams();
    if (opts.scope) qs.set('scope', opts.scope);
    if (opts.userId) qs.set('userId', opts.userId);
    if (opts.entityType) qs.set('entityType', opts.entityType);
    if (opts.entityId) qs.set('entityId', opts.entityId);
    if (opts.projectId) qs.set('projectId', opts.projectId);
    if (opts.action) qs.set('action', opts.action);
    if (opts.orgId) qs.set('orgId', opts.orgId);
    if (opts.since) qs.set('since', opts.since);
    if (opts.limit) qs.set('limit', String(opts.limit));
    if (opts.cursor) qs.set('cursor', opts.cursor);
    return this.request<{
      events: AuditEvent[];
      scope: 'platform' | 'tenant';
      nextCursor: string | null;
      limit: number;
    }>(`/api/audit-log${qs.toString() ? `?${qs.toString()}` : ''}`);
  }

  auditLogActions(scope?: 'platform' | 'tenant') {
    const qs = scope ? `?scope=${scope}` : '';
    return this.request<{ actions: string[] }>(`/api/audit-log/actions${qs}`);
  }

  auditLogEntity(type: string, id: string) {
    return this.request<{
      events: AuditEvent[];
      entityType: string;
      entityId: string;
    }>(`/api/audit-log/entity/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  }

  auditLogDetail(id: string) {
    return this.request<{ event: AuditEvent }>(`/api/audit-log/${encodeURIComponent(id)}`);
  }

  async platformQaBenchmarks() {
    return this.request<{
      certification: {
        engineVersion: string;
        standard: string;
        suiteTolerance: number;
        tests: Array<{ name: string; passed: number; total: number; maxDriftPct: number }>;
        aggregate: { passed: number; total: number };
        frontendUnitTests: { passed: number; total: number; framework: string };
        submission: {
          filed: boolean;
          filedAt: string;
          contact: string;
          status: string;
          slaMonths: number;
        };
      };
      engineVersions: Array<{ engine_version: string; calc_type: string; count: number }>;
      calcVolume: {
        total: number;
        d24h: number;
        d7: number;
        d30: number;
        d30_complete: number;
        d30_error: number;
        d30_pending: number;
      };
      calcDuration: {
        sample_size: number | null;
        p50: number | null;
        p95: number | null;
        p99: number | null;
        p100: number | null;
      };
      calcMix: Array<{ calc_type: string; count: number }>;
      auditVolume: { total: number; d24h: number; d7: number; d30: number };
      shadowRunDrift: {
        sample_size: number | null;
        n_projects: number | null;
        avg_abs_heat_pct: number | null;
        avg_abs_sens_pct: number | null;
        avg_abs_latent_pct: number | null;
        max_abs_heat_pct: number | null;
        max_abs_sens_pct: number | null;
        max_abs_latent_pct: number | null;
      } | null;
      shadowRunReliability: {
        shadow_success: number | null;
        shadow_failure: number | null;
      } | null;
      shadowRunFailureCauses: Array<{
        cause: string;
        count: number;
        n_projects: number;
      }> | null;
      generatedAt: string;
    }>('/api/platform/qa-benchmarks');
  }

  // ── Team management ─────────────────────────────────────────────────────
  async teamList() {
    return this.request<{
      members: Array<{
        id: string; email: string;
        first_name: string | null; last_name: string | null;
        role: 'admin' | 'engineer' | 'tech' | 'viewer';
        is_verified: number; last_seen_at: string | null;
        created_at: string;
        status?: 'active' | 'deactivated';
      }>;
      invites: Array<{
        id: string; invited_email: string; invited_role: string;
        status: string; invited_by: string;
        expires_at: string; created_at: string;
        token: string;
        // 'new_user' = classic signup invite; 'reparent' = account-transfer
        // request awaiting the target user's in-app consent.
        kind: 'new_user' | 'reparent';
      }>;
      domain: { claimed: string | null; verifiedAt: string | null };
    }>('/api/org/team');
  }

  async teamSetDomain(domain: string) {
    return this.request<{ domain: string | null; verifiedAt: string | null }>(
      '/api/org/domain',
      { method: 'PUT', body: JSON.stringify({ domain }) },
    );
  }

  async teamInvite(email: string, role: 'admin' | 'engineer' | 'tech' | 'viewer' = 'tech', subdivisionId?: string) {
    return this.request<{
      id: string;
      invitedEmail: string;
      invitedRole: string;
      token: string;
      expiresAt: string;
      // New since email delivery shipped:
      redeemUrl: string;
      emailSent: boolean;
      emailError: string | null;
    }>('/api/org/invite', {
      method: 'POST',
      body: JSON.stringify(subdivisionId ? { email, role, subdivisionId } : { email, role }),
    });
  }

  async teamRevokeInvite(id: string) {
    return this.request<{ ok: boolean }>(`/api/org/invites/${id}`, { method: 'DELETE' });
  }

  async teamSetRole(userId: string, role: 'admin' | 'engineer' | 'tech' | 'viewer') {
    return this.request<{ ok: boolean; role: string }>(`/api/org/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  async teamRemoveMember(userId: string) {
    return this.request<{ ok: boolean; status: string }>(`/api/org/users/${userId}`, { method: 'DELETE' });
  }

  async teamReactivateMember(userId: string) {
    return this.request<{ ok: boolean; status: string }>(
      `/api/org/users/${userId}/reactivate`,
      { method: 'POST' },
    );
  }

  // Advisory consequence engine — call before committing a role change
  // or deactivation. proposedRole=null means deactivation. The commit
  // endpoints independently re-enforce 'block' items (server is truth),
  // so a clean preflight just means the UI can pass through frictionlessly.
  async teamRoleChangePreflight(userId: string, proposedRole: 'admin' | 'engineer' | 'tech' | 'viewer' | null) {
    return this.request<{
      targetUserId: string;
      targetEmail: string | null;
      currentRole: string | null;
      currentStatus: string | null;
      proposedRole: string | null;
      clear: boolean;
      blockers: Array<{
        code: 'sole_admin' | 'sole_permit_authority' | 'owned_projects' | 'open_permit_submissions';
        severity: 'block' | 'warn';
        message: string;
        count?: number;
      }>;
    }>(`/api/org/users/${userId}/role-change/preflight`, {
      method: 'POST',
      body: JSON.stringify({ role: proposedRole }),
    });
  }

  // ── Subdivisions (child orgs — DBAs, subsidiaries) ──────────────────────
  async teamSubdivisions() {
    return this.request<{
      parent: { id: string; name: string } | null;
      subdivisions: Array<{
        id: string; name: string; slug: string; org_type: string;
        created_at: string;
        user_count: number; project_count: number; pending_invite_count: number;
      }>;
    }>('/api/org/subdivisions');
  }

  async teamCreateSubdivision(name: string, orgType: 'company' | 'municipality' | 'individual' = 'company') {
    return this.request<{
      subdivision: { id: string; name: string; slug: string; orgType: string; userCount: number; projectCount: number };
    }>('/api/org/subdivisions', {
      method: 'POST',
      body: JSON.stringify({ name, orgType }),
    });
  }

  async teamDeleteSubdivision(id: string) {
    return this.request<{ ok: true }>(`/api/org/subdivisions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ── Reparent (account transfer) ─────────────────────────────────────────
  // Admin side: request to pull a fragmented (solo-org) user in. The move
  // happens only when the target user accepts via authTransferAccept.
  async teamReparent(email: string, role: 'admin' | 'engineer' | 'tech' | 'viewer' = 'tech') {
    return this.request<{
      id: string;
      invitedEmail: string;
      invitedRole: string;
      expiresAt: string;
      emailSent: boolean;
      emailError: string | null;
    }>('/api/org/reparent', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  }

  // Target-user side: pending transfer requests addressed to my email.
  async authTransfers() {
    return this.request<{
      transfers: Array<{
        id: string; invited_role: string; expires_at: string; created_at: string;
        org_name: string | null; org_type: string | null;
        inviter_first_name: string | null; inviter_last_name: string | null;
        inviter_email: string | null;
      }>;
    }>('/api/auth/transfers');
  }

  /** Accept a transfer: my account moves into the requesting org. Returns a
   *  fresh login-shaped session for the NEW org (all old tokens are dead). */
  async authTransferAccept(id: string) {
    return this.request<{
      token: string;
      refreshToken: string;
      user: {
        id: string; email: string; firstName: string | null; lastName: string | null;
        role: string; isVerified: boolean; isPlatformAdmin: boolean; isPermitAuthority: boolean;
      };
      organisation: { id: string; name: string; type: string; slug: string; regionCode: string };
    }>(`/api/auth/transfers/${encodeURIComponent(id)}/accept`, { method: 'POST' });
  }

  async authTransferDecline(id: string) {
    return this.request<{ ok: true }>(`/api/auth/transfers/${encodeURIComponent(id)}/decline`, { method: 'POST' });
  }

  // ── Community / forum ───────────────────────────────────────────────────
  async forumShareProject(projectId: string, isPublic: boolean, summary?: string) {
    return this.request<{ id: string; isPublic: boolean; summary: string | null }>(
      `/api/forum/projects/${projectId}/share`,
      { method: 'POST', body: JSON.stringify({ isPublic, summary }) },
    );
  }

  async forumListProjects(params: { sort?: 'recent' | 'oldest' | 'comments'; q?: string; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.sort) qs.set('sort', params.sort);
    if (params.q) qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<{
      projects: Array<{
        id: string; name: string; share_summary: string;
        climate_zone: string | null; standard: string;
        shared_at: string; org_id: string;
        org_name: string | null; org_type: string | null;
        comment_count: number;
      }>;
      sort: string; limit: number; q: string;
    }>(`/api/forum/projects${suffix}`);
  }

  async forumGetProject(id: string) {
    return this.request<{
      project: {
        id: string; name: string; share_summary: string;
        climate_zone: string | null; standard: string;
        shared_at: string; org_id: string;
        org_name: string | null; org_type: string | null;
      };
      comments: Array<{
        id: string; body: string;
        created_at: string; updated_at: string | null; deleted_at: string | null;
        author_user_id: string; author_org_id: string;
        author_first_name: string | null; author_last_name: string | null;
        author_org_name: string | null;
      }>;
    }>(`/api/forum/projects/${id}`);
  }

  async forumAddComment(projectId: string, body: string) {
    return this.request<{
      id: string; body: string; created_at: string;
      author_user_id: string; author_org_id: string;
    }>(`/api/forum/projects/${projectId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async forumDeleteComment(id: string) {
    return this.request<{ ok: boolean }>(`/api/forum/comments/${id}`, { method: 'DELETE' });
  }

  // ── Permit Authority rail ──────────────────────────────────────────────

  async authorityGetProfile() {
    return this.request<{
      authority: {
        authorityType: string | null;
        authorityTitle: string | null;
        jurisdictionStates: string[];
        jurisdictionCounties: string[];
        jurisdictionZips: string[];
        intakeNotes: string | null;
        intakeEmail: string | null;
      };
    }>('/api/org/authority');
  }

  async authorityPutProfile(input: {
    authorityType: string | null;
    authorityTitle?: string | null;
    jurisdictionStates?: string[];
    jurisdictionCounties?: string[];
    jurisdictionZips?: string[];
    intakeNotes?: string | null;
    intakeEmail?: string | null;
  }) {
    return this.request<{ ok: boolean }>('/api/org/authority', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async teamSetAuthorityFlag(userId: string, isPermitAuthority: boolean) {
    return this.request<{ ok: boolean; isPermitAuthority: boolean }>(
      `/api/org/users/${userId}/authority`,
      { method: 'PATCH', body: JSON.stringify({ isPermitAuthority }) },
    );
  }

  async permitsSearchAuthorities(params: {
    zip?: string; state?: string; county?: string; type?: string;
  } = {}) {
    const qs = new URLSearchParams();
    if (params.zip) qs.set('zip', params.zip);
    if (params.state) qs.set('state', params.state);
    if (params.county) qs.set('county', params.county);
    if (params.type) qs.set('type', params.type);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<{
      authorities: Array<{
        id: string; name: string; slug: string;
        authority_type: string; authority_title: string | null;
        jurisdiction_states: string | null;
        jurisdiction_counties: string | null;
        jurisdiction_zips: string | null;
        authority_intake_notes: string | null;
        city: string | null; state: string | null; zip: string | null;
        phone: string | null;
        _score: number; _matched: string[];
      }>;
      criteria: { zip?: string; state?: string; county?: string; type?: string };
    }>(`/api/permits/authorities${suffix}`);
  }

  async permitSubmit(input: {
    projectId: string;
    authorityOrgId: string;
    submissionType?: string;
    coverLetter?: string;
    parentSubmissionId?: string;
  }) {
    return this.request<{ id: string; status: string }>('/api/permits/submit', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async permitListSubmissions(status?: string) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request<{
      submissions: Array<{
        id: string; project_id: string; status: string;
        submission_type: string | null; submitted_at: string;
        reviewed_at: string | null; permit_number: string | null;
        decision_notes: string | null;
        submitter_org_id: string; authority_org_id: string;
        expires_at: string | null;
        suspended_at: string | null;
        revoked_at: string | null;
        parent_submission_id: string | null;
        project_name: string | null;
        project_address: string | null; project_city: string | null;
        project_state: string | null; project_zip: string | null;
        submitter_org_name: string | null;
        authority_org_name: string | null;
        authority_title: string | null;
      }>;
    }>(`/api/permits/submissions${qs}`);
  }

  async permitGetSubmission(id: string) {
    return this.request<{
      submission: Record<string, unknown>;
      project: Record<string, unknown> | null;
      calculations: Array<Record<string, unknown>>;
      comments: Array<{
        id: string; body: string; is_internal: number;
        deleted_at: string | null; created_at: string;
        author_user_id: string; author_org_id: string;
        author_first_name: string | null; author_last_name: string | null;
        author_org_name: string | null;
        author_is_authority: number;
      }>;
      party: 'submitter' | 'authority' | null;
      parentSubmission: {
        id: string; status: string;
        submission_type: string | null;
        submitted_at: string;
        reviewed_at: string | null;
        decision_notes: string | null;
        permit_number: string | null;
      } | null;
    }>(`/api/permits/submissions/${id}`);
  }

  /** State-machine action on a permit submission.
   *  - Pre-decision (authority): claim, approve, deny, request_changes
   *  - Lifecycle  (authority): suspend, revoke, reinstate, set_expiration
   *  - Submitter-side: withdraw
   *  Reason (decisionNotes) is required for deny / request_changes /
   *  suspend / revoke / reinstate. expiresAt is optional on approve and
   *  required on set_expiration. */
  async permitAct(id: string, input: {
    action: 'claim' | 'approve' | 'deny' | 'request_changes' | 'withdraw'
          | 'suspend' | 'revoke' | 'reinstate' | 'set_expiration';
    decisionNotes?: string;
    permitNumber?: string;
    expiresAt?: string | null;
  }) {
    return this.request<{ ok: boolean; status: string; expiresAt?: string | null }>(
      `/api/permits/submissions/${id}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  }

  async permitGetTimeline(id: string) {
    return this.request<{
      transitions: Array<{
        id: string;
        from_status: string | null;
        to_status: string;
        reason: string | null;
        automated: number;
        created_at: string;
        actor_user_id: string | null;
        actor_org_id: string | null;
        actor_first_name: string | null;
        actor_last_name: string | null;
        actor_org_name: string | null;
      }>;
    }>(`/api/permits/submissions/${id}/timeline`);
  }

  async permitAddComment(id: string, body: string, isInternal = false) {
    return this.request<{ id: string; isInternal: boolean; created_at: string }>(
      `/api/permits/submissions/${id}/comments`,
      { method: 'POST', body: JSON.stringify({ body, isInternal }) },
    );
  }

  // ── Catalog / Product Inventory (org-owned, session-scoped) ────────────────
  /** List/search the org's product catalog. Every result is the caller's own
   *  org inventory — the server scopes by the session-derived org_id. */
  async listCatalog(filters?: { category?: string; q?: string; limit?: number; activeOnly?: boolean }) {
    const qs = new URLSearchParams();
    if (filters?.category) qs.set('category', filters.category);
    if (filters?.q) qs.set('q', filters.q);
    if (filters?.limit) qs.set('limit', String(filters.limit));
    if (filters?.activeOnly) qs.set('activeOnly', '1');
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.request<{ items: ApiCatalogProductRow[] }>(`/api/catalog${suffix}`);
  }

  /** Bulk-upsert (idempotent on org_id+sku). Admin-gated server-side; the same
   *  endpoint a future ERP/inventory feed will push to via a service token. */
  async bulkUpsertCatalog(items: BulkCatalogItemInput[]) {
    return this.request<{ upsertedCount: number; createdCount: number; updatedCount: number }>(
      '/api/catalog/items',
      { method: 'POST', body: JSON.stringify({ items }) },
    );
  }

  // Feedback
  async submitFeedback(data: {
    type: string;
    text: string;
    context: string;
    userAgent: string;
    files: File[];
  }) {
    const formData = new FormData();
    formData.append('type', data.type);
    formData.append('text', data.text);
    formData.append('context', data.context);
    formData.append('userAgent', data.userAgent);
    for (const file of data.files) {
      formData.append('files', file);
    }

    return this.request<{ id: string; status: string; attachmentCount: number; routedTo?: string[] }>('/api/feedback', {
      method: 'POST',
      body: formData,
    });
  }
}

export const api = new ApiClient();
