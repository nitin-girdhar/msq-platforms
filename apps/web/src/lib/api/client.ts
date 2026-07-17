import { createApiClient } from '@crm/ui';

// The generic fetch wrapper (error normalization, credentials, JSON handling)
// lives in @crm/ui so a second module (Leave/Attendance/Tasks) can build its
// own domain-specific api.* namespace without duplicating it. Everything below
// this line is CRM domain knowledge and stays in apps/web.
const { request } = createApiClient('/api');

// ── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (email: string, password: string, org_id?: string) =>
    request<{ success: true; data: { user: import('@crm/types').SessionUser } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, org_id }),
    }),

  logout: () => request<{ success: true; data: null }>('/auth/logout', { method: 'POST' }),

  myOrgs: () =>
    request<{ success: true; data: { orgs: import('@crm/types').UserOrgOption[] } }>('/auth/my-orgs'),

  switchOrg: (org_id: string) =>
    request<{ success: true; data: { user: import('@crm/types').SessionUser } }>('/auth/switch-org', {
      method: 'POST',
      body: JSON.stringify({ org_id }),
    }),

  me: () => request<{ success: true; data: { user: import('@crm/types').SessionUser } }>('/auth/me'),

  changePassword: (current_password: string, new_password: string) =>
    request<{ success: true; data: null }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
};

// ── Leads ────────────────────────────────────────────────────────────────────

export interface LeadsListParams {
  status?: string;
  assigned_to?: string;
  assigned_user_id?: string;
  campaign_id?: string;
  search?: string;
  platforms?: string;
  org_ids?: string;
  page?: number;
  page_size?: number;
}

export const leads = {
  list: (params: LeadsListParams = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{
      success: true;
      data: import('@crm/types').LeadView[];
      total: number;
      page: number;
      page_size: number;
      stage_options: unknown[];
      stage_outcomes: unknown[];
    }>(`/leads${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) =>
    request<{ success: true; data: import('@crm/types').LeadView }>(`/leads/${id}`),

  create: (data: Record<string, unknown>) =>
    request<{ success: true; data: { id: string } }>('/leads', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Record<string, unknown>) =>
    request<void>(`/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/leads/${id}`, { method: 'DELETE' }),

  getTimeline: (id: string) =>
    request<{ success: true; data: unknown[] }>(`/leads/${id}/timeline`),

  getFormData: (id: string) =>
    request<{ success: true; data: import('@crm/types').LeadFormData }>(`/leads/${id}/form-data`),

  getInteractions: (id: string) =>
    request<{ success: true; data: unknown[] }>(`/leads/${id}/interactions`),

  addInteraction: (id: string, data: Record<string, unknown>) =>
    request<{ success: true; data: unknown }>(`/leads/${id}/interactions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getFollowUps: (id: string) =>
    request<{ success: true; data: unknown[] }>(`/leads/${id}/follow-ups`),

  addFollowUp: (id: string, data: Record<string, unknown>) =>
    request<{ success: true; data: unknown }>(`/leads/${id}/follow-ups`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateFollowUp: (lead_id: string, follow_up_id: string, data: Record<string, unknown>) =>
    request<void>(`/leads/${lead_id}/follow-ups/${follow_up_id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getAssignmentHistory: (id: string) =>
    request<{ success: true; data: unknown[] }>(`/leads/${id}/assignment-history`),

  transfer: (id: string, data: { target_org_id: string; notes?: string }) =>
    request<{ success: true; data: { sourceLeadId: string; newLeadId: string } }>(`/leads/${id}/transfer`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ── Users ────────────────────────────────────────────────────────────────────

export const users = {
  list: (params?: { org_id?: string; page_size?: number }) => {
    const qs = new URLSearchParams(
      Object.entries(params ?? {})
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<{ success: true; data: unknown[]; total: number; page: number; page_size: number }>(`/users${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<{ success: true; data: unknown }>(`/users/${id}`),

  create: (data: Record<string, unknown>) =>
    request<{ success: true; data: { id: string; email: string }; temporary_password: string }>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Record<string, unknown>) =>
    request<void>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/users/${id}`, { method: 'DELETE' }),

  resetPassword: (id: string, new_password?: string) =>
    request<{ success: true; data: { temporary_password: string } }>(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password }),
    }),

  assignable: (orgId?: string) =>
    request<{ success: true; data: unknown[] }>(`/users/assignable${orgId ? `?org_id=${orgId}` : ''}`),

  orgChart: () => request<{ success: true; data: unknown[] }>('/users/org-chart'),

  team: () => request<{ success: true; data: unknown[] }>('/users/team'),
};

// ── API Clients (public API token management) ──────────────────────────────

export interface ApiClientView {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  org_ids: string[];
  scope_all_orgs: boolean;
  rate_limit_per_min: number;
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export const apiClients = {
  list: () => request<{ success: true; data: ApiClientView[] }>('/api-clients'),

  create: (data: Record<string, unknown>) =>
    request<{ success: true; data: ApiClientView & { api_key: string } }>('/api-clients', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Record<string, unknown>) =>
    request<{ success: true; data: ApiClientView }>(`/api-clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  rotate: (id: string) =>
    request<{ success: true; data: ApiClientView & { api_key: string } }>(`/api-clients/${id}/rotate`, {
      method: 'POST',
    }),

  revoke: (id: string) =>
    request<void>(`/api-clients/${id}`, { method: 'DELETE' }),
};

// ── Assignments ───────────────────────────────────────────────────────────────

export const assignments = {
  list: () => request<{ success: true; data: unknown[]; total: number; page: number; page_size: number }>('/assignments'),

  get: (id: string) => request<{ success: true; data: unknown }>(`/assignments/${id}`),

  create: (data: { lead_id: string; assigned_to: string; branch?: string; notes?: string }) =>
    request<{ success: true; data: unknown }>('/assignments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { assigned_to: string; notes?: string }) =>
    request<void>(`/assignments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  remove: (id: string) =>
    request<void>(`/assignments/${id}`, { method: 'DELETE' }),

  leadsHistory: (params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{
      success: true;
      data: import('@crm/types').LeadView[];
      total: number;
      page: number;
      page_size: number;
      stage_options: unknown[];
      stage_outcomes: unknown[];
    }>(`/assignments/mine${qs ? `?${qs}` : ''}`);
  },
};

// ── Campaigns ─────────────────────────────────────────────────────────────────

export const campaigns = {
  list: () => request<{ success: true; data: unknown[] }>('/campaigns'),

  get: (id: string) => request<{ success: true; data: unknown }>(`/campaigns/${id}`),

  create: (data: { name: string; platform_name: string; status_name?: string; budget?: number; started_at?: string; ended_at?: string }) =>
    request<{ success: true; data: { id: string } }>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Record<string, unknown>) =>
    request<void>(`/campaigns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/campaigns/${id}`, { method: 'DELETE' }),
};

// ── Orgs ─────────────────────────────────────────────────────────────────────

export const orgs = {
  list: (params: { cityIds?: string; stateIds?: string; countryIds?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{ success: true; data: Array<{ id: string; name: string; org_id: string; org_name?: string; city_id?: number | null; state_id?: number | null; country_id?: number | null; cityId?: number | null; stateId?: number | null; countryId?: number | null; geoLat?: number | null; geoLng?: number | null; timezone?: string }> }>(`/orgs${qs ? `?${qs}` : ''}`);
  },

  all: () => request<{ success: true; data: Array<{ id: string; name: string; org_id: string }> }>('/orgs/all'),

  updateGeo: (id: string, body: { geo_lat?: number | null; geo_lng?: number | null }) =>
    request<{ success: true; data: { id: string; geoLat: number | null; geoLng: number | null } }>(`/orgs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

// ── Lead Sources ─────────────────────────────────────────────────────────────

export const lead_sources = {
  list: () => request<{ success: true; data: Array<{ id: string; name: string }> }>('/lead-sources'),
};

// ── Lookups ───────────────────────────────────────────────────────────────────

export const lookups = {
  leadStages: () => request<{ success: true; data: unknown[] }>('/lookups/lead-stages'),
  leadStageOutcomes: (stage_id?: string) =>
    request<{ success: true; data: unknown[] }>(`/lookups/lead-stage-outcomes${stage_id !== undefined ? `?stage_id=${stage_id}` : ''}`),
  all: () => request<{ success: true; data: { platforms: unknown[]; interaction_types: unknown[]; sources: unknown[]; stages: unknown[]; campaign_statuses: unknown[] } }>('/lookups'),
  cities: (state_id?: number) =>
    request<{ success: true; data: unknown[] }>(`/lookups/cities${state_id !== undefined ? `?state_id=${state_id}` : ''}`),
};

// ── Locations ─────────────────────────────────────────────────────────────────

export const locations = {
  get: (params: { country_id?: number; state_id?: number } = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{
      success: true;
      data: {
        countries: unknown[];
        states: unknown[];
        cities: unknown[];
      };
    }>(`/locations${qs ? `?${qs}` : ''}`);
  },

  list: (params: { level?: string; countryIds?: string; stateIds?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{ success: true; data: unknown[] }>(`/locations${qs ? `?${qs}` : ''}`);
  },
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export const analytics = {
  dashboard: () => request<{ success: true; data: unknown }>('/analytics/dashboard'),
  campaigns: () => request<{ success: true; data: unknown[] }>('/analytics/dashboard/campaigns'),
  performance: () => request<{ success: true; data: unknown }>('/analytics/performance'),
  pipeline: () => request<{ success: true; data: unknown[] }>('/analytics/pipeline'),
};

// ── Activities ────────────────────────────────────────────────────────────────

export const activities = {
  list: () => request<{ success: true; data: unknown[] }>('/activities'),
};

// ── Follow-Ups ───────────────────────────────────────────────────────────────

export const followUps = {
  list: (params: { assignedRepId?: string; overdueOnly?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{ success: true; data: unknown[]; pipeline?: unknown[] }>(`/follow-ups${qs ? `?${qs}` : ''}`);
  },
};
