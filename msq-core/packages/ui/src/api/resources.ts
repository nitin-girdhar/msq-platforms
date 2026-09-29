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

  // can_view_all: the server's answer to whether the switcher may offer
  // "All branches" — decided there, never inferred from the client.
  myOrgs: () =>
    request<{ success: true; data: { orgs: import('@platform/types').UserOrgOption[]; can_view_all?: boolean } }>('/auth/my-orgs'),

  // `tenant_id` with all_branches: a platform super_admin's "All branches of
  // <tenant>" — refused server-side for everyone else.
  switchOrg: (target: { org_id: string } | { all_branches: true; tenant_id?: string }) =>
    request<{ success: true; data: { user: import('@platform/types').SessionUser } }>('/auth/switch-org', {
      method: 'POST',
      body: JSON.stringify(target),
    }),
};

// Web Push device registration. Ungated, self-service platform surface — see
// msq-lms/services/notifications-service/src/routes/push.ts for why identity is
// always server-derived and never taken from the posted body.
export const push = {
  publicKey: () =>
    request<{ success: true; data: { public_key: string } }>('/notifications/push/public-key'),

  // Body is the raw browser PushSubscription JSON (`subscription.toJSON()`).
  // Zod on the server strips anything that is not `endpoint` / `keys`.
  subscribe: (subscription: PushSubscriptionJSON) =>
    request<{ success: true; data: { registered: boolean } }>('/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),

  unsubscribe: (endpoint: string) =>
    request<void>('/notifications/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
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

// Appends lookup-admin's explicit tenant scope (see providers/UserAdminScope)
// to a /users path. No scope, or an empty one, leaves the path untouched — the
// server then scopes by the session, which is every host but lookup-admin.
type AdminScope = { tenant_id?: string | undefined };
function withAdminScope(path: string, scope?: AdminScope): string {
  if (!scope?.tenant_id) return path;
  return `${path}${path.includes('?') ? '&' : '?'}tenant_id=${encodeURIComponent(scope.tenant_id)}`;
}

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

  create: (data: Record<string, unknown>, scope?: AdminScope) =>
    request<{ success: true; data: { id: string; email: string; hr_profile_synced: boolean }; temporary_password: string }>(withAdminScope('/users', scope), {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Record<string, unknown>, scope?: AdminScope) =>
    request<{ success: true; data: { hr_profile_synced: boolean } }>(withAdminScope(`/users/${id}`, scope), {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string, scope?: AdminScope) =>
    request<void>(withAdminScope(`/users/${id}`, scope), { method: 'DELETE' }),

  resetPassword: (
    id: string,
    new_password?: string,
    override_policy?: boolean,
    force_password_change?: boolean,
    send_email_notification?: boolean,
    scope?: AdminScope,
  ) =>
    request<{ success: true; data: { temporary_password: string } }>(withAdminScope(`/users/${id}/reset-password`, scope), {
      method: 'POST',
      body: JSON.stringify({ new_password, override_policy, force_password_change, send_email_notification }),
    }),

  // `product` is required: it gates candidates on that product's CAPABILITY
  // node so the rank ladder (shared across every product, and freely
  // extensible with custom tenant roles) doesn't leak unrelated staff into an
  // assignee picker. Pass the product the picker actually belongs to.
  // `purpose` defaults to 'assign' server-side, where an LMS list ignores
  // `scope`/`maxRank` and derives the ceiling from the actor's own
  // lms.leads.assign.* grants instead. Pass 'filter' when the list populates a
  // filter rather than an assignee picker — that list answers "who works leads
  // in this branch": no ceiling relative to the actor, but still bounded to the
  // rank band above read_only / below org_admin and gated on the `lms.leads`
  // tool node (not the coarse `lms` product root).
  assignable: (opts: { product: 'lms' | 'tasks'; orgId?: string; orgIds?: string[]; scope?: 'delegation' | 'collaboration'; maxRank?: number; purpose?: 'assign' | 'filter'; tenantId?: string | undefined }) => {
    const params = new URLSearchParams();
    params.set('product', opts.product);
    if (opts.tenantId) params.set('tenant_id', opts.tenantId);
    if (opts.orgId) params.set('org_id', opts.orgId);
    // `orgIds` is the multi-branch form, for a filter list spanning several orgs
    // at once; single-branch callers keep using `orgId`. Both are honored only
    // for an actor whose scope actually reaches other branches.
    if (opts.orgIds?.length) params.set('org_ids', opts.orgIds.join(','));
    if (opts.scope) params.set('scope', opts.scope);
    if (opts.maxRank !== undefined) params.set('max_rank', String(opts.maxRank));
    if (opts.purpose) params.set('purpose', opts.purpose);
    const qs = params.toString();
    return request<{ success: true; data: unknown[] }>(`/users/assignable${qs ? `?${qs}` : ''}`);
  },

  // Roles this actor may actually grant, already capped at their own rank by the
  // server, plus the departments those roles belong to. `department_id` is null
  // for roles a tenant has not filed under one — a real bucket, not an error.
  roleCatalog: (scope?: AdminScope) =>
    request<{ success: true; data: {
      roles: Array<{ id: string; name: string; label: string; rank: number; department_id: string | null; department_label: string | null; works_leads: boolean }>;
      departments: Array<{ id: string; label: string }>;
    } }>(withAdminScope('/users/role-catalog', scope)),

  // Who may manage a user in `orgId`: members of that branch, plus tenant_admin
  // and above. Must be asked per branch — the roster alone cannot answer it,
  // since it carries only each user's home org.
  managerCandidates: (orgId: string, scope?: AdminScope) =>
    request<{ success: true; data: Array<{
      id: string; full_name: string; email: string;
      role_name: string; role_label: string; rank: number; in_branch: boolean;
    }> }>(withAdminScope(`/users/manager-candidates?org_id=${encodeURIComponent(orgId)}`, scope)),

  // Current per-user lead weights in a branch, optionally scoped to one
  // campaign type (1.49.0 — weights are keyed per (org, campaign_type), so a
  // caller that wants just one pool's total should filter server-side rather
  // than summing the whole branch). Omit orgId for the actor's own branch.
  assignmentWeights: (orgId?: string, campaignTypeId?: string, scope?: AdminScope) => {
    const params = new URLSearchParams();
    if (scope?.tenant_id) params.set('tenant_id', scope.tenant_id);
    if (orgId) params.set('org_id', orgId);
    if (campaignTypeId) params.set('campaign_type_id', campaignTypeId);
    const qs = params.toString();
    return request<{ success: true; data: Array<{
      user_id: string; full_name: string; email: string;
      campaign_type_id: string; campaign_type: string; campaign_type_label: string;
      weight: number;
    }> }>(`/users/assignment-weights${qs ? `?${qs}` : ''}`);
  },

  // Every branch a user holds, with the role and per-campaign-type weights in
  // each. The view behind it resolves org_name/role_label, so callers never
  // look up raw ids.
  orgMappings: (userId: string, scope?: AdminScope) =>
    request<{ success: true; data: Array<{
      org_id: string; org_name: string; role_id: string; role_label: string;
      weights: Array<{ campaign_type_id: string; campaign_type: string; campaign_type_label: string; weight: number }>;
      is_active: boolean;
    }> }>(withAdminScope(`/users/${userId}/org-mappings`, scope)),

  // The tenant's full campaign-type catalog — read-through so OrgAssignmentsField
  // can group weight inputs without needing leads-service's
  // LMS_CAMPAIGN_TYPES_VIEW capability (gated on admin.team.manage instead; see
  // users.controller.ts's getCampaignTypeCatalog).
  campaignTypeCatalog: (scope?: AdminScope) =>
    request<{ success: true; data: Array<{
      id: string; name: string; label: string; department_id: string | null; is_default: boolean;
    }> }>(withAdminScope('/users/campaign-type-catalog', scope)),

  // `orgId` picks the branch — required by the server when a super_admin
  // works another tenant (scope.tenant_id); everyone else gets their own.
  orgChart: (scope?: AdminScope & { org_id?: string | undefined }) => {
    const path = scope?.org_id ? `/users/org-chart?org_id=${encodeURIComponent(scope.org_id)}` : '/users/org-chart';
    return request<{ success: true; data: unknown[] }>(withAdminScope(path, scope));
  },

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
