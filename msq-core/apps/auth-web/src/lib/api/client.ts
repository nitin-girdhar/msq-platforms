import { createApiClient } from '@platform/ui-kit';

// auth-web talks only to the shared gateway's auth surface. The generic fetch
// wrapper (error normalization, credentials, JSON handling) lives in
// @platform/ui-kit. Product domain namespaces (leads, leave, tasks) live in
// their own product apps — never here.
// redirectOnUnauthorized is OFF for this app specifically. auth-web IS the login
// surface: here a 401 means "wrong credentials" or "not signed in yet", which is
// a normal, expected outcome the form must render. Reloading on it would discard
// the typed password and the error message, and /auth/me deliberately 401s for
// an anonymous visitor. Product apps keep the redirect on — see createApiClient.
const { request } = createApiClient('/api', { redirectOnUnauthorized: false });

export const auth = {
  // licensed_products rides alongside the user because the auth cookie is
  // httpOnly — it is how the form works out which product to land on.
  login: (email: string, password: string, org_id?: string) =>
    request<{
      success: true;
      data: {
        user: import('@platform/types').SessionUser;
        licensed_products: import('@platform/types').ProductKey[];
      };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, org_id }),
    }),

  logout: () => request<{ success: true; data: null }>('/auth/logout', { method: 'POST' }),

  myOrgs: () =>
    request<{ success: true; data: { orgs: import('@platform/types').UserOrgOption[] } }>('/auth/my-orgs'),

  switchOrg: (org_id: string) =>
    request<{ success: true; data: { user: import('@platform/types').SessionUser } }>('/auth/switch-org', {
      method: 'POST',
      body: JSON.stringify({ org_id }),
    }),

  me: () => request<{ success: true; data: { user: import('@platform/types').SessionUser } }>('/auth/me'),

  changePassword: (current_password: string, new_password: string) =>
    request<{ success: true; data: null }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
};
