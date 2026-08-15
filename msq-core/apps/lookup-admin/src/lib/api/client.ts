import { createApiClient } from '@platform/ui-kit';

// Was a hand-rolled copy of the same wrapper. The shared one additionally
// flattens Zod `details` into a readable message and bounces to login on a 401
// instead of surfacing "Unauthorized" as a toast on a page that then keeps
// rendering stale data.
const { request } = createApiClient('/api');

// Separate instance with the 401 redirect OFF, for the auth surface only. On the
// login form a 401 means "wrong credentials" — a normal outcome the form must
// render — and reloading would discard the typed password and the error message.
const { request: authRequest } = createApiClient('/api', { redirectOnUnauthorized: false });

// ── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (email: string, password: string, org_id?: string) =>
    authRequest<{ success: true; data: { user: import('@platform/types').SessionUser } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, org_id }),
    }),

  logout: () => authRequest<{ success: true; data: null }>('/auth/logout', { method: 'POST' }),

  me: () => authRequest<{ success: true; data: { user: import('@platform/types').SessionUser } }>('/auth/me'),
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

  // Cascading geo lookups backing the country -> state -> city fk chain on the
  // organizations form, and the three geo lookup tables themselves.
  //
  // These hit admin-service's tenant-scoped /lookups/geo-* routes rather than
  // leads-service's /locations. leads-service derives the tenant from the
  // CALLER's org, which is wrong here: a super_admin editing tenant B's branch
  // would have been offered tenant A's cities. The tenant is passed explicitly.
  //
  // Filtering to is_active happens client-side (below) rather than in the API,
  // because these same rows have to stay listable — including the inactive
  // ones — on the geo lookup tables' own admin pages.
  geo: {
    countries: (tenantId: string) =>
      request<{ success: true; data: Array<{ id: string; name: string; is_active?: boolean }> }>(
        `/lookups/geo-countries?tenant_id=${tenantId}`,
      ),

    states: (tenantId: string) =>
      request<{ success: true; data: Array<{ id: string; name: string; country_id: string; is_active?: boolean }> }>(
        `/lookups/geo-states?tenant_id=${tenantId}`,
      ),

    cities: (tenantId: string) =>
      request<{ success: true; data: Array<{ id: string; name: string; state_id: string; is_active?: boolean }> }>(
        `/lookups/geo-cities?tenant_id=${tenantId}`,
      ),
  },
};

// ── Capabilities (admin.roles.manage) ───────────────────────────────────────

export interface CapabilityRow {
  id: string;
  key: string;
  kind: 'tool' | 'page' | 'tab' | 'operation' | 'scope';
  parent_key: string | null;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface RoleCapabilityRow {
  id: string;
  tenant_id: string | null;
  role_id: string;
  capability_id: string;
  is_granted: boolean;
}

export interface DepartmentRow {
  id: string;
  tenant_id: string;
  org_id: string | null;
  name: string;
  label: string;
  is_active: boolean;
}

export const capabilitiesApi = {
  list: () => request<{ success: true; data: CapabilityRow[] }>('/capabilities'),

  forRole: (roleId: string, tenantId: string) =>
    request<{ success: true; data: RoleCapabilityRow[] }>(
      `/roles/${roleId}/capabilities?tenant_id=${tenantId}`,
    ),

  putGrants: (roleId: string, tenantId: string, grants: Array<{ capability_id: string; is_granted: boolean }>) =>
    request<{ success: true; data: RoleCapabilityRow[] }>(`/roles/${roleId}/capabilities`, {
      method: 'PUT',
      body: JSON.stringify({ tenant_id: tenantId, grants }),
    }),
};

export const departmentsApi = {
  list: (tenantId: string) =>
    request<{ success: true; data: DepartmentRow[] }>(`/departments?tenant_id=${tenantId}`),
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

  getAssignable: (product: 'lms' | 'tasks', orgId?: string, scope?: 'delegation' | 'collaboration') =>
    request<{ success: true; data: UserRow[] }>(`/users/assignable?product=${product}${orgId ? `&org_id=${orgId}` : ''}${scope ? `&scope=${scope}` : ''}`),

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

  resetPassword: (id: string, new_password?: string, force_password_change?: boolean) =>
    request<{ success: true; data: { temporary_password: string } }>(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password, force_password_change }),
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
