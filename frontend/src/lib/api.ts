import { toast } from '../stores/useToastStore';

// API base URL — set VITE_API_BASE_URL in environment (Cloudflare Pages / .env.local)
// When unset, API calls go to same origin (Pages functions or local dev proxy)
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('hvac_session_token', token);
    } else {
      localStorage.removeItem('hvac_session_token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('hvac_session_token');
    }
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          ...options,
          headers,
        });

        // 401 — no retry, clear session immediately
        if (res.status === 401) {
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
      } catch (err: any) {
        // If it's our own thrown error (401, 4xx, or final 5xx), re-throw
        if (err === lastError || err.message === 'Session expired' || (err instanceof Error && err.message !== 'Failed to fetch')) {
          throw err;
        }

        // Network error — retry if attempts remain
        lastError = err;
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
    return this.request<{ token: string; user: any; organisation: any }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(email: string, password: string) {
    return this.request<{ token: string; user: any; organisation: any }>('/api/auth/login', {
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
    return this.request<{ user: any; organisation: any }>('/api/auth/me');
  }

  // Projects
  async listProjects() {
    return this.request<{ projects: any[] }>('/api/projects');
  }

  async getProject(id: string) {
    return this.request<{ project: any }>(`/api/projects/${id}`);
  }

  async createProject(data: { name: string; address?: string; city?: string; state?: string; zip?: string; climateZone?: string; standard?: string }) {
    return this.request<{ project: any }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProject(id: string, data: any) {
    return this.request<{ project: any }>(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id: string) {
    return this.request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' });
  }

  // Calculations
  async listCalculations(projectId: string) {
    return this.request<{ calculations: any[] }>(`/api/calculations/project/${projectId}`);
  }

  async saveCalculation(data: { projectId: string; calcType: string; inputs: any; outputs: any; engineVersion?: string; durationMs?: number }) {
    return this.request<{ id: string; version: number }>('/api/calculations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getCalculation(id: string) {
    return this.request<any>(`/api/calculations/${id}`);
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
    return this.request<{ files: any[] }>(`/api/uploads/project/${projectId}`);
  }

  async deleteFile(id: string) {
    return this.request<{ ok: boolean }>(`/api/uploads/${id}`, { method: 'DELETE' });
  }

  // CAD drawings
  async listDrawings(projectId: string) {
    return this.request<{ drawings: any[] }>(`/api/cad/project/${projectId}`);
  }

  async getDrawing(id: string) {
    return this.request<any>(`/api/cad/${id}`);
  }

  async saveDrawing(data: { projectId: string; name?: string; floorIndex?: number; canvasJson: any }) {
    return this.request<{ id: string }>('/api/cad', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDrawing(id: string, data: { canvasJson: any; name?: string }) {
    return this.request<{ ok: boolean }>(`/api/cad/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDrawing(id: string) {
    return this.request<{ ok: boolean }>(`/api/cad/${id}`, { method: 'DELETE' });
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
