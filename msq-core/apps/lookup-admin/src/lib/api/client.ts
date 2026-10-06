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

// A scope: 'tenant' table sends only tenant_id. A scope: 'org' table
// (hr.designations) sends BOTH: org_id is the row-level filter, and tenant_id
// still pins the admin-write RLS session (there is no tenant_id column to
// derive it from server-side — see db_scripts/08_rls.sql's
// admin_tenant_config_policy on hr.designations).
function scopeQuery(tenantId?: string, orgId?: string): string {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenant_id', tenantId);
  if (orgId) params.set('org_id', orgId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const lookupAdmin = {
  list: (table: string, tenantId?: string, orgId?: string) =>
    request<{ success: true; data: Record<string, unknown>[] }>(
      `/lookups/${table}${scopeQuery(tenantId, orgId)}`,
    ),

  create: (table: string, body: unknown, tenantId?: string, orgId?: string) =>
    request<{ success: true; data: Record<string, unknown> }>(
      `/lookups/${table}${scopeQuery(tenantId, orgId)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  update: (table: string, id: string, body: unknown, tenantId?: string, orgId?: string) =>
    request<{ success: true; data: Record<string, unknown> }>(
      `/lookups/${table}/${id}${scopeQuery(tenantId, orgId)}`,
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

// Departments moved under /lookups/* when they became writable, so the generic
// [table] grid can manage them; this stays as the FkSelect option source.
export const departmentsApi = {
  list: (tenantId: string) =>
    request<{ success: true; data: DepartmentRow[] }>(`/lookups/departments?tenant_id=${tenantId}`),
};

// ── Lead Stage CAPI event mapping (bespoke — see lead-stage-capi-events tab) ──

export interface LeadStageCapiEventRow {
  stage_id: string;
  stage_name: string;
  stage_label: string;
  capi_event_type_id: number | null;
}

export const leadStageCapiEvents = {
  list: (tenantId: string) =>
    request<{ success: true; data: LeadStageCapiEventRow[] }>(
      `/lookups/lead-stage-capi-events?tenant_id=${tenantId}`,
    ),

  put: (tenantId: string, mappings: Array<{ stage_id: string; capi_event_type_id: number | null }>) =>
    request<{ success: true; data: LeadStageCapiEventRow[] }>(
      `/lookups/lead-stage-capi-events?tenant_id=${tenantId}`,
      { method: 'PUT', body: JSON.stringify({ mappings }) },
    ),
};

// ── Tenant module entitlements (bespoke — see tenants/[id]/modules) ──────────

export type ModuleKey = 'lms' | 'leave' | 'attendance' | 'tasks';

export interface TenantModuleRow {
  module: ModuleKey;
  is_active: boolean;
}

export const tenantModules = {
  list: (tenantId: string) =>
    request<{ success: true; data: TenantModuleRow[] }>(`/tenants/${tenantId}/modules`),

  put: (tenantId: string, modules: ModuleKey[]) =>
    request<{ success: true; data: TenantModuleRow[] }>(`/tenants/${tenantId}/modules`, {
      method: 'PUT',
      body: JSON.stringify({ modules }),
    }),
};

// ── Catalog version drift (read-only report) ──────────────────────────────

export interface CatalogDriftRow {
  tenant_id: string;
  tenant_name: string;
  catalog_key: string;
  current_version: number;
  tenant_version: number | null;
  seeded_at: string | null;
}

export const catalogDrift = {
  list: () => request<{ success: true; data: CatalogDriftRow[] }>('/catalogs/drift'),
};

// ── Meta page/form → org mapping (bespoke — see /dashboard/meta-mappings) ──

// ext.meta_page_form_org_map: which branch every inbound Meta lead lands in.
// Served by meta-conversion-api through the gateway's /meta/page-org-map
// routes, all four of them super-admin gated and all four requiring the
// ADMINISTERED tenant as ?tenant_id= — never the caller's own, since platform
// staff belong to a different tenant than the one they are administering.
export type MetaPlatform = 'fb' | 'ig' | 'wa';

export interface MetaPageOrgMapRow {
  id: string;
  tenant_id: string;
  org_id: string;
  // page_id/form_id are BIGINT columns projected as ::text by the service, so
  // they arrive as strings and must stay strings — a 16-digit Meta id does not
  // survive a round trip through a JS number.
  page_id: string;
  // NULL is the page-level catch-all: every form on the page routes to org_id
  // unless a more specific form_id row exists.
  form_id: string | null;
  platform: MetaPlatform;
  // 1.51.0: the page/form fallback type — used when neither a confirmed
  // campaign nor an ordered rule types the lead, and for organic leads.
  default_campaign_type_id: string | null;
  default_campaign_type_label: string | null;
  is_active: boolean;
  // When a lead last arrived through this row (webhook or lead-pull Apply).
  last_synced_at: string | null;
}

export interface MetaPageOption {
  page_id: string;
  name: string | null;
  // 1.51.0: who already maps this page. 'other' pages belong to another tenant
  // and must not be mapped or pulled here (the service refuses their forms).
  owner?: 'this' | 'other' | null;
  owner_tenant_name?: string | null;
}

export interface MetaPageForm {
  form_id: string;
  name: string | null;
  status: string | null;
  leads_count: number | null;
  // The branch an exact form row already routes this form to, if any.
  mapped_org_id: string | null;
}

export interface CreateMetaMappingInput {
  org_id: string;
  page_id: string;
  // Omitted entirely (not sent as null) for a page-level row — see
  // MappingFormModal; the service's schema takes either, this keeps the wire
  // payload the same shape the page-level case reads as.
  form_id?: string;
  platform: MetaPlatform;
  default_campaign_type_id?: string | null;
}

export interface UpdateMetaMappingInput {
  org_id?: string;
  is_active?: boolean;
  platform?: MetaPlatform;
  // null clears the default; omitted leaves it.
  default_campaign_type_id?: string | null;
}

export const metaMappings = {
  // No org_id param: the service's list route validates its query with
  // tenantScopedQuerySchema (tenant_id only), so an org_id here would be
  // silently dropped rather than applied — worse than not sending it. The
  // navbar org narrows the grid client-side instead; see the meta-mappings page.
  list: (tenantId: string) =>
    request<{ success: true; data: MetaPageOrgMapRow[] }>(
      `/meta/page-org-map?tenant_id=${encodeURIComponent(tenantId)}`,
    ),

  pages: (tenantId: string) =>
    request<{ success: true; data: MetaPageOption[] }>(
      `/meta/pages?tenant_id=${encodeURIComponent(tenantId)}`,
    ),

  create: (tenantId: string, body: CreateMetaMappingInput) =>
    request<{ success: true; data: { id: string } }>(
      `/meta/page-org-map?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // The live leadgen forms on one page (1.51.0) — the form picker. Refused for a
  // page mapped to another tenant.
  pageForms: (tenantId: string, pageId: string) =>
    request<{ success: true; data: MetaPageForm[] }>(
      `/meta/pages/${encodeURIComponent(pageId)}/forms?tenant_id=${encodeURIComponent(tenantId)}`,
    ),

  // 204 No Content — `request` returns undefined for it. page_id/form_id are the
  // row's identity and stay immutable (an edit that needs to change them is a
  // deactivate plus a new row); branch, platform, default type and active are
  // editable (1.51.0).
  update: (tenantId: string, mappingId: string, body: UpdateMetaMappingInput) =>
    request<void>(
      `/meta/page-org-map/${mappingId}?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
};

// ── Meta campaign → type mapping (bespoke — see /dashboard/meta-campaigns) ──
//
// ext.meta_campaigns decides whether an inbound Meta lead is a SALES lead or a
// HIRING lead — the campaign's TYPE picks which pool in a branch it routes to.
// Served by meta-conversion-api through the gateway's /meta/campaigns routes,
// all three super-admin gated and all three requiring the ADMINISTERED tenant
// as ?tenant_id= (never the caller's own), exactly like /meta/page-org-map.
export type MappingStatus = 'unmapped' | 'suggested' | 'confirmed';

export interface MetaCampaignRow {
  id: string;
  tenant_id: string;
  ad_account_id: string | null;
  // BIGINT projected as ::text by the service — a 17-digit Meta id does not
  // survive a round trip through a JS number.
  meta_campaign_id: string;
  name: string | null;
  objective: string | null;
  effective_status: string | null;
  meta_created_time: string | null;
  campaign_type_id: string | null;
  campaign_type_name: string | null;
  campaign_type_label: string | null;
  mapping_status: MappingStatus;
  // The pattern of the rule that produced the suggestion.
  matched_keyword: string | null;
  // 1.51.0: the rule engine's guess; campaign_type_id is set only by a confirm.
  suggested_campaign_type_id: string | null;
  suggested_campaign_type_label: string | null;
  matched_rule_id: string | null;
  // Pages the campaign's ad sets promote (strings — 16+ digit ids).
  page_ids: string[];
  // Set when the campaign's pages map to more than one tenant.
  conflict_reason: string | null;
  // 1.70.0: hidden from the working lists. Visibility only — routing is unchanged.
  is_archived: boolean;
  archived_at: string | null;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  first_seen_source: string | null;
  last_synced_at: string | null;
  lead_count: number;
}

export interface CampaignSyncError {
  ad_account_id: string | null;
  meta_campaign_id: string | null;
  message: string;
}

export interface CampaignSyncIssue {
  meta_campaign_id: string;
  name: string | null;
  page_ids: string[];
}

export interface CampaignSyncResult {
  fetched: number;
  inserted: number;
  suggested: number;
  unmapped: number;
  confirmed_untouched: number;
  // 1.51.0: campaigns whose pages map to no tenant / to more than one.
  unattributed: CampaignSyncIssue[];
  conflicts: CampaignSyncIssue[];
  // Campaigns attributed to another tenant, skipped by a tenant-scoped fetch.
  other_tenant: number;
  ad_accounts: number;
  errors: CampaignSyncError[];
}

export interface ReclassifyBranchResult {
  org_id: string;
  org_name: string;
  leads_relabelled: number;
  leads_reassigned: number;
  leads_left_unassigned: number;
}

export interface ReclassifyResult {
  dry_run: boolean;
  campaigns_relabelled: number;
  leads_relabelled: number;
  leads_reassigned: number;
  leads_left_unassigned: number;
  by_branch: ReclassifyBranchResult[];
}

export interface ConfirmCampaignResult {
  dry_run: boolean;
  meta_campaign_id: string;
  campaign_type_id: string;
  // 1.51.0: the rule added with the confirm (or that would be, on a dry run).
  added_rule: { pattern: string; match_field: RuleMatchField } | null;
  // True once a real confirm has committed the mapping; false on a dry run.
  mapping_saved: boolean;
  // Always present on a dry run. Null only when a real confirm SAVED the mapping
  // but re-routing its existing leads then failed — reclassification_error says
  // why, and confirming again retries just the re-route.
  reclassification: ReclassifyResult | null;
  reclassification_error: string | null;
}

export interface ConfirmCampaignInput {
  campaign_type_id: string;
  // 1.51.0: optionally add an ordered rule for this type in the same action.
  add_rule?: { pattern: string; match_field: RuleMatchField };
}

export const metaCampaigns = {
  list: (tenantId: string, pageId?: string) =>
    request<{ success: true; data: MetaCampaignRow[] }>(
      `/meta/campaigns?tenant_id=${encodeURIComponent(tenantId)}${pageId ? `&page_id=${encodeURIComponent(pageId)}` : ''}`,
    ),

  sync: (tenantId: string) =>
    request<{ success: true; data: CampaignSyncResult }>(
      `/meta/campaigns/sync?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST' },
    ),

  // 1.70.0: hide / restore campaigns from the working lists (visibility only).
  archive: (tenantId: string, metaCampaignIds: string[], archived: boolean) =>
    request<{ success: true; data: { updated: number } }>(
      `/meta/campaigns/archive?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST', body: JSON.stringify({ meta_campaign_ids: metaCampaignIds, archived }) },
    ),

  // dry_run=true previews the mapping change and the lead fan-out and WRITES
  // NOTHING — not the mapping, not the keyword, not a single lead. See
  // confirmCampaignMapping's own comment in campaign-admin.service.ts for why
  // the mapping write and the fan-out are ordered the way they are on a real run.
  confirm: (tenantId: string, metaCampaignId: string, body: ConfirmCampaignInput, dryRun: boolean) =>
    request<{ success: true; data: ConfirmCampaignResult }>(
      `/meta/campaigns/${metaCampaignId}?tenant_id=${encodeURIComponent(tenantId)}&dry_run=${dryRun}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
};

// ── Campaign types (feeds the meta-campaigns type dropdowns) ───────────────
//
// The ADMINISTERED tenant travels as ?tenant_id=, exactly like /meta/campaigns*.
// leads-service honours it only for a platform super_admin (router gate +
// controller rank check) and pins the transaction to that tenant, so the types
// listed here are the selected tenant's — the ids the confirm dialog then
// writes are ones that tenant's RLS accepts.
export interface CampaignTypeRow {
  id: string;
  name: string;
  label: string;
  description: string | null;
  department_id: string | null;
  match_keywords: string[];
  is_default: boolean;
  match_priority: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type RuleMatchField = 'campaign_name' | 'form_name' | 'adset_name' | 'ad_name';

// marketing.campaign_type_rules (1.51.0): FIRST MATCH WINS in rule_order.
export interface CampaignTypeRuleRow {
  id: string;
  rule_order: number;
  match_field: RuleMatchField;
  pattern: string;
  campaign_type_id: string;
  campaign_type_label: string | null;
  campaign_type_is_active: boolean | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RuleTestResult {
  campaign_type_id: string | null;
  campaign_type_label: string | null;
  rule_id: string | null;
  match_field: RuleMatchField | null;
  pattern: string | null;
}

export interface CreateCampaignTypeInput {
  name: string;
  label: string;
  description?: string;
  department_id?: string | null;
}

export interface UpdateCampaignTypeInput {
  label?: string;
  description?: string | null;
  department_id?: string | null;
  is_active?: boolean;
}

function tq(tenantId: string): string {
  return `?tenant_id=${encodeURIComponent(tenantId)}`;
}

export const campaignTypes = {
  list: (tenantId: string) =>
    request<{ success: true; data: CampaignTypeRow[] }>(`/campaign-types${tq(tenantId)}`),

  create: (tenantId: string, body: CreateCampaignTypeInput) =>
    request<{ success: true; data: { id: string } }>(`/campaign-types${tq(tenantId)}`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  update: (tenantId: string, id: string, body: UpdateCampaignTypeInput) =>
    request<void>(`/campaign-types/${id}${tq(tenantId)}`, { method: 'PATCH', body: JSON.stringify(body) }),

  rules: (tenantId: string) =>
    request<{ success: true; data: CampaignTypeRuleRow[] }>(`/campaign-types/rules${tq(tenantId)}`),

  createRule: (
    tenantId: string,
    body: { match_field: RuleMatchField; pattern: string; campaign_type_id: string; rule_order?: number },
  ) =>
    request<{ success: true; data: { id: string } }>(`/campaign-types/rules${tq(tenantId)}`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  updateRule: (
    tenantId: string,
    ruleId: string,
    body: { match_field?: RuleMatchField; pattern?: string; campaign_type_id?: string; is_active?: boolean },
  ) =>
    request<void>(`/campaign-types/rules/${ruleId}${tq(tenantId)}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteRule: (tenantId: string, ruleId: string) =>
    request<void>(`/campaign-types/rules/${ruleId}${tq(tenantId)}`, { method: 'DELETE' }),

  // The WHOLE live list in its new order — partial lists are refused.
  reorderRules: (tenantId: string, ruleIds: string[]) =>
    request<void>(`/campaign-types/rules/order${tq(tenantId)}`, {
      method: 'PUT', body: JSON.stringify({ rule_ids: ruleIds }),
    }),

  testRules: (
    tenantId: string,
    names: { campaign_name?: string; form_name?: string; adset_name?: string; ad_name?: string },
  ) =>
    request<{ success: true; data: RuleTestResult }>(`/campaign-types/rules/test${tq(tenantId)}`, {
      method: 'POST', body: JSON.stringify(names),
    }),
};

// ── Meta ad accounts under the shared integration (1.51.0) ──────────────────
// PLATFORM-level — no tenant_id. The campaign fetch walks the ENABLED ones and
// attributes each campaign to a tenant by the pages it promotes.
export interface MetaAdAccountRow {
  ad_account_id: string;
  name: string | null;
  business_name: string | null;
  account_status: number | null;
  is_enabled: boolean;
  last_synced_at: string | null;
  last_seen_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export interface MetaTokenPermissions {
  is_valid: boolean;
  expires_at: string | null;
  scopes: string[];
  missing: string[];
}

export const metaAdAccounts = {
  list: () => request<{ success: true; data: MetaAdAccountRow[] }>('/meta/ad-accounts'),
  sync: () =>
    request<{ success: true; data: { seen: number; added: number; accounts: MetaAdAccountRow[] } }>(
      '/meta/ad-accounts/sync', { method: 'POST' },
    ),
  setEnabledBulk: (adAccountIds: string[], isEnabled: boolean) =>
    request<{ success: true; data: MetaAdAccountRow[] }>('/meta/ad-accounts/bulk', {
      method: 'POST', body: JSON.stringify({ ad_account_ids: adAccountIds, is_enabled: isEnabled }),
    }),
  tokenPermissions: () =>
    request<{ success: true; data: MetaTokenPermissions }>('/meta/ad-accounts/token-permissions'),
  setEnabled: (adAccountId: string, isEnabled: boolean) =>
    request<{ success: true; data: MetaAdAccountRow }>(`/meta/ad-accounts/${encodeURIComponent(adAccountId)}`, {
      method: 'PATCH', body: JSON.stringify({ is_enabled: isEnabled }),
    }),
};

// ── Meta lead inbox (1.51.0) ─────────────────────────────────────────────────
// Webhook leads that did not land. tenantId null = the tenant-less rows (pages
// mapped to nobody), which only a super admin can see.
export type InboxReason = 'unmapped' | 'missing_contact' | 'sync_failed';
export type InboxStatus = 'open' | 'resolved' | 'ignored';

export interface MetaLeadInboxRow {
  id: string;
  meta_lead_id: string;
  tenant_id: string | null;
  org_id: string | null;
  page_id: string | null;
  form_id: string | null;
  campaign_id: string | null;
  platform: MetaPlatform | null;
  lead_created_at: string | null;
  reason: InboxReason;
  error_text: string | null;
  status: InboxStatus;
  attempts: number;
  resolved_lead_id: string | null;
  lead_name: string | null;
  created_at: string;
  updated_at: string;
}

function inboxQuery(tenantId: string | null, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams(
    Object.entries({ tenant_id: tenantId ?? undefined, ...extra })
      .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')
      .map(([k, v]) => [k, v]),
  );
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ── Meta page token health (1.70.0) ─────────────────────────────────────────
export type PageTokenStatus = 'ok' | 'missing' | 'expired' | 'error';

export interface MetaPageHealthRow {
  page_id: string;
  token_status: PageTokenStatus;
  // null = could not be determined.
  is_subscribed: boolean | null;
  error_text: string | null;
  checked_at: string;
}

export const metaPageHealth = {
  list: (tenantId: string) =>
    request<{ success: true; data: MetaPageHealthRow[] }>(`/meta/pages/health?tenant_id=${encodeURIComponent(tenantId)}`),
  // One Graph call per mapped page, so it can take a while.
  validate: (tenantId: string) =>
    request<{ success: true; data: MetaPageHealthRow[] }>(
      `/meta/pages/health/validate?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST' },
    ),
};

export const metaLeadInbox = {
  list: (tenantId: string | null, status: InboxStatus = 'open', reason?: InboxReason) =>
    request<{ success: true; data: MetaLeadInboxRow[] }>(`/meta/lead-inbox${inboxQuery(tenantId, { status, reason })}`),
  retry: (tenantId: string | null, id: string) =>
    request<{ success: true; data: { status: 'resolved'; marketing_lead_id: string; duplicate: boolean; assigned_user_id: string | null } }>(
      `/meta/lead-inbox/${id}/retry${inboxQuery(tenantId)}`, { method: 'POST' },
    ),
  ignore: (tenantId: string | null, id: string) =>
    request<void>(`/meta/lead-inbox/${id}/ignore${inboxQuery(tenantId)}`, { method: 'POST' }),
};

// ── Meta lead pull (bespoke — see /dashboard/lead-pull) ─────────────────────
//
// The three-stage backfill CLI (download -> reconcile -> import) a developer
// used to run by hand, moved into a button: choose scope + a required since
// date, poll a background run, review the delta against the SAME
// classification the live webhook's canonical import path uses, apply only
// what is genuinely missing. Served by meta-conversion-api through the
// gateway's /meta/lead-pull/* routes, all five super-admin gated and all five
// requiring the ADMINISTERED tenant as ?tenant_id= — never the caller's own —
// exactly like /meta/page-org-map and /meta/campaigns. GET /meta/pages (see
// `metaMappings.pages` above) doubles as this screen's page picker; it is not
// re-fetched here.
//
// KNOWN DOC/CODE MISMATCH, reported rather than worked around (this screen is
// UI-only): the phase brief lists `hiring_form` as its own verdict bucket.
// meta-conversion-api's lead-reconcile.service.ts does NOT classify leads that
// way — that behaviour was deliberately removed once campaign types could
// route a recruitment lead somewhere. A lead on a hiring-shaped form still gets
// a normal verdict (new / a duplicate / etc.) and is separately flagged with
// `is_hiring_form` + `suggested_campaign_type_id` on the row. There is no
// `hiring_form` verdict to drill into from the summary; the staged-leads grid
// surfaces the flag per row instead.
export type PullVerdict =
  | 'already_synced'
  | 'test_lead'
  | 'unmapped_form'
  | 'missing_contact'
  | 'phone_duplicate'
  | 'email_duplicate'
  | 'new';

// Matches meta-conversion-api's IMPORTABLE_VERDICTS exactly. The two duplicate
// verdicts are importable ON PURPOSE: the canonical write path supersedes on a
// phone match / returns the existing lead on an email match, and either way it
// writes the ext.meta_leads tracking row that stops the lead being re-fetched
// by every future pull.
export const IMPORTABLE_PULL_VERDICTS: readonly PullVerdict[] = ['new', 'phone_duplicate', 'email_duplicate'];

export interface PullCampaignOption {
  meta_campaign_id: string;
  name: string | null;
  effective_status: string | null;
  // The confirmed type, else the rule suggestion.
  campaign_type_label: string | null;
  mapping_status: MappingStatus;
}

export type PullMode = 'pages' | 'campaign';

export interface CreatePullRunInput {
  org_ids?: string[];
  page_ids?: string[];
  campaign_ids?: string[];
  since: string;
  until?: string;
  // 1.51.0: 'campaign' walks only the selected campaigns' ads.
  mode?: PullMode;
}

export type PullTriggerKind = 'manual' | 'scheduled';

export interface RemapResult {
  remapped: number;
  still_unmapped: number;
  verdicts: Record<string, number>;
}

export interface PullPageError {
  page_id: string;
  reason: string;
}

export interface PullRunCounts {
  pages_in_scope: number;
  pages_walked: number;
  forms_walked: number;
  leads_returned: number;
  leads_staged: number;
  // Leads on forms mapped to a branch outside the selected orgs — dropped, not
  // staged (and not misreported as unmapped_form).
  out_of_scope: number;
  truncated_forms: string[];
  truncated: boolean;
  page_errors: PullPageError[];
  campaign_filter_applied: boolean;
  verdicts: Record<string, number>;
  // 1.51.0
  ads_walked?: number;
  foreign_pages_skipped?: number;
  // Written by the worker when an Apply pass finishes: that PASS's tallies. After
  // an interrupted-then-resumed Apply, `apply_summary` on the run is the
  // whole-run truth.
  apply: PullApplyResult;
}

// apply_queued: Apply was pressed and is waiting for the server's worker. Apply
// runs in the background like the pull itself, so both it and `applying` are
// in-flight states the screen keeps polling through.
export type PullRunLifecycleStatus =
  | 'queued' | 'running' | 'completed' | 'failed' | 'apply_queued' | 'applying' | 'applied' | 'discarded';

export interface PullRunStatus {
  id: string;
  status: PullRunLifecycleStatus;
  trigger_kind: PullTriggerKind;
  filters: {
    org_ids: string[];
    page_ids: string[];
    campaign_ids: string[];
    since: string;
    until: string | null;
    mode?: PullMode;
  };
  // Written by the poller as the run's own PullRunCounts; a queued/running run
  // has not filled every field in yet, hence Partial.
  counts: Partial<PullRunCounts>;
  heartbeat_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  applied_at: string | null;
  error_text: string | null;
  created_at: string;
  // Live tallies computed from the staged rows — this is what the delta
  // summary renders, not `counts.verdicts`.
  verdict_summary: Partial<Record<PullVerdict | 'unclassified', number>>;
  apply_summary: Partial<Record<'pending' | 'applied' | 'skipped' | 'failed', number>>;
  // Rows Apply would import right now (importable AND ticked).
  importable: number;
  // 1.70.0: importable rows regardless of the ticks.
  importable_total: number;
  discarded_at: string | null;
  // Distinct pages behind the unmapped_form verdict, over every staged row —
  // each one links to Meta Page Mapping filtered to that page.
  unmapped_page_ids: string[];
  campaign_filter_is_post_fetch: boolean;
}

export interface StagedLeadRow {
  id: string;
  org_id: string | null;
  page_id: string;
  form_id: string;
  form_name: string | null;
  meta_lead_id: string;
  campaign_id: string | null;
  platform: MetaPlatform | null;
  lead_created_at: string | null;
  verdict: PullVerdict | null;
  reason: string | null;
  existing_lead_id: string | null;
  is_hiring_form: boolean;
  suggested_campaign_type_id: string | null;
  suggested_campaign_type_label: string | null;
  applied_status: 'pending' | 'applied' | 'skipped' | 'failed';
  applied_lead_id: string | null;
  applied_error: string | null;
  // 1.70.0: whether Apply will import this row.
  apply_selected: boolean;
}

export interface PullApplyResult {
  attempted: number;
  applied: number;
  already_synced: number;
  skipped: number;
  failed: number;
}

// The shape of `ApiRequestError.body.details` on the 409 createRun throws —
// the run already live for this tenant, so the screen can offer to jump to it
// instead of just reporting the conflict.
export interface PullRunConflictDetails {
  run_id: string;
  status: string;
}

export interface PullHistoryRow {
  run_id: string;
  trigger_kind: PullTriggerKind;
  status: PullRunLifecycleStatus;
  filters: Record<string, unknown>;
  counts: Record<string, unknown>;
  created_by: string | null;
  created_by_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  applied_at: string | null;
  discarded_at: string | null;
  error_text: string | null;
  created_at: string;
}

export const leadPull = {
  // Narrows the campaign picker to campaigns already observed on the selected
  // pages. Selecting some of the results does NOT make the pull itself faster
  // or cheaper — see campaign_filter_is_post_fetch on the run and the note next
  // to the campaign control in PullFilterForm.
  campaigns: (tenantId: string, pageIds: string[]) =>
    request<{ success: true; data: PullCampaignOption[]; campaign_filter_is_post_fetch: boolean }>(
      `/meta/lead-pull/campaigns?tenant_id=${encodeURIComponent(tenantId)}${
        pageIds.length ? `&page_ids=${pageIds.join(',')}` : ''
      }`,
    ),

  // 202 — the run row exists, the work has not been done yet. Returns
  // immediately with a run_id to poll. Throws a 409 (ApiRequestError, `.body.details`
  // shaped like PullRunConflictDetails) when a run is already live for this tenant.
  createRun: (tenantId: string, body: CreatePullRunInput) =>
    request<{ success: true; data: { run_id: string } }>(
      `/meta/lead-pull/runs?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // The tenant's current run (at most one — a new Pull deletes the previous), or
  // data: null. What the screen reopens on load, so leaving the page mid-pull or
  // before Apply no longer loses the run.
  latestRun: (tenantId: string, triggerKind: PullTriggerKind = 'manual') =>
    request<{ success: true; data: { run_id: string; status: PullRunLifecycleStatus } | null }>(
      `/meta/lead-pull/runs/latest?tenant_id=${encodeURIComponent(tenantId)}&trigger_kind=${triggerKind}`,
    ),

  // 1.51.0: after mapping a page/form inline, re-resolve the run's unmapped rows.
  remap: (tenantId: string, runId: string) =>
    request<{ success: true; data: RemapResult }>(
      `/meta/lead-pull/runs/${runId}/remap?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST' },
    ),

  getRun: (tenantId: string, runId: string) =>
    request<{ success: true; data: PullRunStatus }>(
      `/meta/lead-pull/runs/${runId}?tenant_id=${encodeURIComponent(tenantId)}`,
    ),

  // The staged rows behind one summary number. verdict omitted = every row.
  listLeads: (tenantId: string, runId: string, verdict?: PullVerdict, page = 1, pageSize = 100) => {
    const params = new URLSearchParams({
      tenant_id: tenantId,
      page: String(page),
      page_size: String(pageSize),
    });
    if (verdict) params.set('verdict', verdict);
    return request<{ success: true; data: StagedLeadRow[]; total: number; page: number; page_size: number }>(
      `/meta/lead-pull/runs/${runId}/leads?${params.toString()}`,
    );
  },

  // 202 — QUEUES the Apply (completed -> apply_queued) and returns at once; the
  // server's worker does the work. Poll getRun until `applied`, then read
  // `counts.apply` / `apply_summary`. A second press gets 409 (the run is no
  // longer `completed`), and the write path is idempotent regardless.
  // 1.70.0: tick / untick staged rows so Apply imports only the chosen ones. `ids`
  // omitted = every importable row (narrowed by `verdict` when given).
  setSelection: (tenantId: string, runId: string, body: { selected: boolean; ids?: string[]; verdict?: PullVerdict }) =>
    request<{ success: true; data: { updated: number; selected: number; importable_total: number } }>(
      `/meta/lead-pull/runs/${runId}/selection?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // 1.70.0: throw a finished batch away without applying it (staged leads deleted).
  discard: (tenantId: string, runId: string) =>
    request<{ success: true; data: { run_id: string } }>(
      `/meta/lead-pull/runs/${runId}/discard?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST' },
    ),

  // 1.70.0: summary of the tenant's past pulls (no lead data).
  history: (tenantId: string, limit = 50) =>
    request<{ success: true; data: PullHistoryRow[] }>(
      `/meta/lead-pull/history?tenant_id=${encodeURIComponent(tenantId)}&limit=${limit}`,
    ),

  apply: (tenantId: string, runId: string) =>
    request<{ success: true; data: { run_id: string; status: 'apply_queued' } }>(
      `/meta/lead-pull/runs/${runId}/apply?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST' },
    ),
};

// ── Re-run auto-assignment (bespoke — see /dashboard/lead-assignment-rerun) ──
//
// Re-routes leads that arrived UNASSIGNED once an admin has fixed their pool
// (weights, or a role's department). Served by leads-service through the
// gateway's super-admin-guarded /lead-assignment/rerun. dry_run previews and
// writes nothing; at most 500 leads per call — pass next_cursor back to continue.
export type RerunSkipReason = 'no_campaign_type' | 'no_weighted_users' | 'no_department_match' | 'no_capable_users';

export interface RerunBranchResult {
  org_id: string;
  org_name: string;
  campaign_type_id: string;
  campaign_type_label: string;
  assigned: number;
  left_unassigned: number;
  reasons: Record<RerunSkipReason, number>;
}

export interface RerunAssignmentResult {
  dry_run: boolean;
  candidates: number;
  assigned: number;
  left_unassigned: number;
  remaining: number;
  next_cursor: string | null;
  by_branch: RerunBranchResult[];
}

export interface RerunAssignmentInput {
  org_ids?: string[];
  campaign_type_ids?: string[];
  cursor?: string;
}

export const leadAssignmentRerun = {
  run: (tenantId: string, body: RerunAssignmentInput, dryRun: boolean) =>
    request<{ success: true; data: RerunAssignmentResult }>(
      `/lead-assignment/rerun?tenant_id=${encodeURIComponent(tenantId)}&dry_run=${dryRun}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
};

// ── Orgs (cross-tenant) ────────────────────────────────────────────────────

// admin-service's /lookups/organizations, not identity-service's /orgs/all —
// see fetchOrgs in src/lib/tenant-scope.ts for why (/orgs/all has no tenant_id
// to filter on, and is pinned to the caller's own tenant).
//
// SNAKE_CASE, and it matters — this is the browser-side twin of fetchOrgs and
// carried the identical bug for longer. It read `o.tenantId` / `o.isActive`,
// but the route answers `tenant_id` / `is_active`, the platform-wide JSON
// contract. Neither camelCase name exists on the response, so every org mapped
// to the STRING "undefined", and every consumer filtering on tenant
// (FkSelect's `o.tenant_id === tenantId`, the Meta mapping screen's org
// picker) matched nothing and rendered an empty dropdown. TypeScript could not
// catch it: the response is cast, not parsed, so the annotation was asserting
// a shape the server never sent.
//
// `is_active` was the mirror image and silently harmless — `undefined !== false`
// is true, so the filter passed everything through and deactivated branches
// would have been offered the moment the tenant_id bug was fixed.
//
// The mapping is kept (rather than returning the response as-is) so callers
// get `id`/`tenant_id` as strings regardless of how the driver serialized the
// uuid columns.
export const orgs = {
  listAll: async (): Promise<{ success: true; data: Array<{ id: string; name: string; tenant_id: string }> }> => {
    const res = await request<{
      success: true;
      data: Array<{ id: string; name: string; tenant_id: string; is_active?: boolean }>;
    }>('/lookups/organizations');
    return {
      success: true,
      data: res.data
        .filter((o) => o.is_active !== false)
        .map((o) => ({ id: String(o.id), name: o.name, tenant_id: String(o.tenant_id) })),
    };
  },
};

// ── Tenant branding (Super Admin) ────────────────────────────────────────────
//
// identity-service /sa/tenants/:id/branding — rank-gated to super admin on the
// server; cross-tenant by design (this is the platform operator's screen).
// Assets go up as base64 and are sniffed/sanitised server-side.

export type BrandAssetSlot =
  | 'logo' | 'logo_dark' | 'mark' | 'favicon' | 'app_icon'
  | 'app_icon_maskable' | 'apple_touch_icon' | 'icon_192' | 'push_icon' | 'push_badge'
  | 'email_logo' | 'login_hero' | 'splash';

export interface SaBrandingView {
  tenant_name: string;
  theme: { preset: string | null; seed_hex: string | null; font: string | null; mode: string | null } | null;
  theme_locked: boolean;
  terms: Record<string, string>;
  nav_overrides: Record<string, { label?: string; icon?: string }>;
  locale_config: Record<string, string | number>;
  product_names: Record<string, Record<string, string>>;
  assets: Record<string, string>;
  asset_meta: Record<string, { content_type: string; bytes: number; updated_at: string }>;
  public_key: string | null;
  updated_at: string | null;
}

export interface SaBrandingUpdate {
  preset?: string | null;
  seed_hex?: string | null;
  font?: string | null;
  default_mode?: string;
  theme_locked?: boolean;
  product_names?: Record<string, Record<string, string>>;
  terms?: Record<string, string>;
  nav_overrides?: Record<string, { label?: string; icon?: string }>;
  locale_config?: Record<string, string | number>;
}

export const saBranding = {
  get: (tenantId: string) =>
    request<{ success: true; data: SaBrandingView }>(`/sa/tenants/${tenantId}/branding`),
  update: (tenantId: string, data: SaBrandingUpdate) =>
    request<{ success: true; data: SaBrandingView }>(`/sa/tenants/${tenantId}/branding`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  uploadAsset: (tenantId: string, slot: BrandAssetSlot, data: string) =>
    request<{ success: true; data: SaBrandingView }>(`/sa/tenants/${tenantId}/branding/assets/${slot}`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    }),
  deleteAsset: (tenantId: string, slot: BrandAssetSlot) =>
    request<{ success: true; data: SaBrandingView }>(`/sa/tenants/${tenantId}/branding/assets/${slot}`, {
      method: 'DELETE',
    }),
  rotateKey: (tenantId: string) =>
    request<{ success: true; data: SaBrandingView }>(`/sa/tenants/${tenantId}/branding/rotate-key`, {
      method: 'POST',
    }),
};
