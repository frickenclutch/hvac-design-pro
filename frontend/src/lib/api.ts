const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://hvac-api.c4-parent-account.workers.dev';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('hvac_auth_token', token);
    } else {
      localStorage.removeItem('hvac_auth_token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('hvac_auth_token');
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

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.setToken(null);
      throw new Error('Session expired');
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || 'Request failed');
    }

    return res.json();
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
}

export const api = new ApiClient();
