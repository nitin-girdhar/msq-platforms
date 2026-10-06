import { createApiClient } from '@platform/ui-kit';
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

// Users/Team calls live in @platform/team-web's own api layer — the screen owns
// the shape of the requests it makes, so a second host mounting it inherits them
// rather than re-declaring them here.

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

// ── Branding (Settings → Branding) ───────────────────────────────────────────
//
// identity-service /tenant/branding: the SESSION's tenant only (RLS); reads
// need admin.branding.view, writes admin.branding.manage. The body schema has
// no asset / product-name / lock / key fields — those are Super Admin's — and
// colour/font/mode changes are refused with BRANDING_THEME_LOCKED while locked.

export interface TenantBrandingView {
  theme: {
    preset: string | null; seed_hex: string | null; font: string | null; mode: string | null;
    /** Sparse hand-tuned colour roles per mode (schema 1.75.0). */
    color_overrides?: import('@platform/ui-kit/theme').ColorOverrides;
  } | null;
  theme_locked: boolean;
  terms: Record<string, string>;
  nav_overrides: Record<string, { label?: string; icon?: string }>;
  locale_config: Record<string, string | number>;
  product_names: Record<string, Record<string, string>>;
  assets: Record<string, string>;
  asset_meta: Record<string, { content_type?: string; bytes?: number; width?: number; height?: number }>;
  public_key: string | null;
  updated_at: string | null;
}

export interface TenantBrandingUpdate {
  preset?: string | null;
  seed_hex?: string | null;
  font?: string | null;
  default_mode?: string;
  /** {} clears every override. Refused below 3:1 text contrast (COLOR_CONTRAST) and while the theme is locked. */
  color_overrides?: import('@platform/ui-kit/theme').ColorOverrides;
}

export const branding = {
  get: () => request<{ success: true; data: TenantBrandingView }>('/tenant/branding'),
  update: (data: TenantBrandingUpdate) =>
    request<{ success: true; data: TenantBrandingView }>('/tenant/branding', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};
