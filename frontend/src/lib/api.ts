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

const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class ApiClient {
  private token: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('hvac_session_token', token);
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
   * Concurrent callers share one in-flight request, so a burst of 401s
   * triggers a single rotation (not a stampede that would trip the server's
   * reuse-detection). Returns false when there's no refresh token or the
   * server rejects it — the caller then clears the session.
   */
  async refreshSession(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json() as { token?: string; refreshToken?: string };
        if (!data.token || !data.refreshToken) return false;
        this.setTokens(data.token, data.refreshToken);
        return true;
      } catch {
        return false;
      }
    })();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let lastError: Error | null = null;
    let triedRefresh = false;
    const isAuthPath = path.startsWith('/api/auth/');

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

        // 401 — try one silent token refresh + retry, then clear the session.
        if (res.status === 401) {
          if (!triedRefresh && !isAuthPath) {
            triedRefresh = true;
            const refreshed = await this.refreshSession();
            if (refreshed) continue; // retry with the rotated access token
          }
          this.setToken(null);
          if (!window.location.pathname.includes('/login') && window.location.pathname !== '/') {
            toast.error('Session expired. Please sign in again.');
          }
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

  async teamInvite(email: string, role: 'admin' | 'engineer' | 'tech' | 'viewer' = 'tech') {
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
      body: JSON.stringify({ email, role }),
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
