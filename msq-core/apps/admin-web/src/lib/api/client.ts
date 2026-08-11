import { createApiClient, users as usersResource } from '@platform/ui-kit';
import type { ApiScope } from '@platform/auth-constants';
import type { SessionUser } from '@platform/types';

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

// ── Users (Team) ─────────────────────────────────────────────────────────────
//
// Thin typed wrappers around @platform/ui-kit's shared `users` resource — the
// same client apps/lms-web's Users screen calls — instead of a second copy of
// the fetch/URL logic. No org_id param is ever sent: identity-service scopes
// /users to the caller's own org/tenant from the gateway-verified session (see
// users.service.ts listUsers — org_id is only honoured for actors above
// org_admin's own-org ceiling). This app is deliberately org/tenant-scoped,
// unlike lookup-admin's cross-tenant Users screen.

export const users = {
  list: () => usersResource.list() as Promise<{ success: true; data: SessionUser[]; total: number; page: number; page_size: number }>,

  create: (body: Record<string, unknown>) => usersResource.create(body),

  update: (id: string, body: Record<string, unknown>) => usersResource.update(id, body),

  // Every branch the user holds. The Edit form needs the full set to send back a
  // complete assignment list; the roster row only carries their home branch.
  orgMappings: (id: string) => usersResource.orgMappings(id),

  resetPassword: (id: string, new_password?: string, override_policy?: boolean) =>
    usersResource.resetPassword(id, new_password, override_policy),
};

// ── API Tokens ───────────────────────────────────────────────────────────────
//
// Hits identity-service's existing /api-clients router unchanged — see
// services/identity-service/src/api/v1/api-clients/*. org_admin is restricted
// server-side to their own org regardless of what org_ids/scope_all_orgs is
// sent (see resolveBranchScope in api-clients.service.ts), so this client never
// needs to think about scope beyond passing through what the form collected.

export interface ApiTokenRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiScope[];
  rate_limit_per_min: number;
  scope_all_orgs: boolean;
  org_ids: string[];
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface CreateApiTokenInput {
  name: string;
  scopes: ApiScope[];
  org_ids?: string[];
  scope_all_orgs?: boolean;
  rate_limit_per_min?: number;
  expires_at?: string;
}

export interface UpdateApiTokenInput {
  name?: string;
  scopes?: ApiScope[];
  org_ids?: string[];
  scope_all_orgs?: boolean;
  rate_limit_per_min?: number;
  expires_at?: string | null;
}

export const apiTokens = {
  list: () => request<{ success: true; data: ApiTokenRow[] }>('/api-clients'),

  create: (body: CreateApiTokenInput) =>
    request<{ success: true; data: ApiTokenRow & { api_key: string } }>('/api-clients', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: UpdateApiTokenInput) =>
    request<{ success: true; data: ApiTokenRow }>(`/api-clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  rotate: (id: string) =>
    request<{ success: true; data: ApiTokenRow & { api_key: string } }>(`/api-clients/${id}/rotate`, {
      method: 'POST',
    }),

  revoke: (id: string) =>
    request<void>(`/api-clients/${id}`, { method: 'DELETE' }),
};
