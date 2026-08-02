import { createApiClient } from './http';

// Platform-tenant resource namespaces consumed by apps/web chrome (users admin)
// and by more than one product package (LMS + HR org filters, Task assignee
// lookup) — kept here rather than duplicated per product.
const { request } = createApiClient('/api');

// Cross-product session actions the shared chrome needs (sign-out, branch
// switch, branch list). Product-specific auth flows (login/change-password)
// live in auth-web; these are the session mutations every product navbar uses.
export const auth = {
  logout: () => request<{ success: true; data: null }>('/auth/logout', { method: 'POST' }),

  myOrgs: () =>
    request<{ success: true; data: { orgs: import('@platform/types').UserOrgOption[] } }>('/auth/my-orgs'),

  switchOrg: (org_id: string) =>
    request<{ success: true; data: { user: import('@platform/types').SessionUser } }>('/auth/switch-org', {
      method: 'POST',
      body: JSON.stringify({ org_id }),
    }),
};

export const orgs = {
  list: (params: { cityIds?: string; stateIds?: string; countryIds?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{ success: true; data: Array<{ id: string; name: string; org_id: string; org_name?: string; city_id?: string | null; state_id?: string | null; country_id?: string | null; cityId?: string | null; stateId?: string | null; countryId?: string | null; geoLat?: number | null; geoLng?: number | null; timezone?: string }> }>(`/orgs${qs ? `?${qs}` : ''}`);
  },

  all: () => request<{ success: true; data: Array<{ id: string; name: string; org_id: string }> }>('/orgs/all'),

  updateGeo: (id: string, body: { geo_lat?: number | null; geo_lng?: number | null }) =>
    request<{ success: true; data: { id: string; geoLat: number | null; geoLng: number | null } }>(`/orgs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

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

  assignable: (opts?: { orgId?: string; scope?: 'delegation' | 'collaboration' }) => {
    const params = new URLSearchParams();
    if (opts?.orgId) params.set('org_id', opts.orgId);
    if (opts?.scope) params.set('scope', opts.scope);
    const qs = params.toString();
    return request<{ success: true; data: unknown[] }>(`/users/assignable${qs ? `?${qs}` : ''}`);
  },

  orgChart: () => request<{ success: true; data: unknown[] }>('/users/org-chart'),

  team: () => request<{ success: true; data: unknown[] }>('/users/team'),

  // Profile photo. `photo` is a base64 string (data: URI prefix optional).
  // uploadMyPhoto is self-service; uploadPhoto targets another user (admin).
  uploadMyPhoto: (body: { photo: string; consent: boolean; content_type?: string }) =>
    request<{ success: true; data: { user_id: string; photo_key: string; photo_uploaded_at: string } }>(
      '/users/me/photo',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  uploadPhoto: (id: string, body: { photo: string; consent: boolean; content_type?: string }) =>
    request<{ success: true; data: { user_id: string; photo_key: string; photo_uploaded_at: string } }>(
      `/users/${id}/photo`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Stable, cacheable URL for a user's photo — safe as an <img src>. The GET is
  // authenticated by the session cookie and returns 404 when there is no photo.
  photoUrl: (id: string) => `/api/users/${id}/photo`,
};
