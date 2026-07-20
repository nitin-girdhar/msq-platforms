const BASE = '/api';

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error((err as { error?: string }).error ?? res.statusText), {
      status: res.status,
      body: err,
    });
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (email: string, password: string, org_id?: string) =>
    request<{ success: true; data: { user: import('@crm/types').SessionUser } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, org_id }),
    }),

  logout: () => request<{ success: true; data: null }>('/auth/logout', { method: 'POST' }),

  me: () => request<{ success: true; data: { user: import('@crm/types').SessionUser } }>('/auth/me'),
};

// ── Lookups ───────────────────────────────────────────────────────────────────

export const lookupAdmin = {
  list: (table: string, tenantId?: string) =>
    request<{ success: true; data: Record<string, unknown>[] }>(
      `/lookups/${table}${tenantId ? `?tenant_id=${tenantId}` : ''}`,
    ),

  create: (table: string, body: unknown, tenantId?: string) =>
    request<{ success: true; data: Record<string, unknown> }>(
      `/lookups/${table}${tenantId ? `?tenant_id=${tenantId}` : ''}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  update: (table: string, id: string, body: unknown, tenantId?: string) =>
    request<{ success: true; data: Record<string, unknown> }>(
      `/lookups/${table}/${id}${tenantId ? `?tenant_id=${tenantId}` : ''}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    ),

  // Cascading geo lookups backing the 'geo-select' field type
  // (country -> state -> city), used by tenants/organizations forms.
  geo: {
    countries: () =>
      request<{ success: true; data: Array<{ id: string | number; name: string }> }>(
        '/locations?level=geo.countries',
      ),

    states: (countryId: string | number) =>
      request<{ success: true; data: Array<{ id: string | number; name: string }> }>(
        `/locations?level=geo.states&countryIds=${countryId}`,
      ),

    cities: (stateId: string | number) =>
      request<{ success: true; data: Array<{ id: string | number; name: string }> }>(
        `/lookups/cities?state_id=${stateId}`,
      ),
  },
};

// ── Orgs (cross-tenant) ────────────────────────────────────────────────────

export const orgs = {
  listAll: () =>
    request<{ success: true; data: Array<{ id: string; name: string; tenant_id: string }> }>('/orgs/all'),
};

// ── Users ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  email: string;
  mobile: string | null;
  role_name: string;
  role_label: string;
  org_id: string;
  org_name: string;
  is_active: boolean;
  force_password_change?: boolean;
  [key: string]: unknown;
}

export interface OrgMappingRow {
  user_id: string;
  org_id: string;
  org_name: string;
  tenant_id: string;
  tenant_name: string;
  role_name: string;
  role_label: string;
  role_rank: number;
  granted_at: string;
  mapping_updated_at: string;
}

export const users = {
  list: () => request<{ success: true; data: UserRow[] }>('/users'),

  create: (body: Record<string, unknown>) =>
    request<{ success: true; data: { id: string; email: string }; temporary_password?: string }>('/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: Record<string, unknown>) =>
    request<{ success: true; data: unknown }>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/users/${id}`, { method: 'DELETE' }),

  resetPassword: (id: string, new_password?: string) =>
    request<{ success: true; data: { temporary_password: string } }>(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password }),
    }),

  orgMappings: {
    list: (userId: string) =>
      request<{ success: true; data: OrgMappingRow[] }>(`/users/${userId}/org-mappings`),

    add: (userId: string, body: unknown) =>
      request<{ success: true; data: OrgMappingRow }>(`/users/${userId}/org-mappings`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    remove: (userId: string, orgId: string) =>
      request<void>(`/users/${userId}/org-mappings/${orgId}`, { method: 'DELETE' }),
  },
};
