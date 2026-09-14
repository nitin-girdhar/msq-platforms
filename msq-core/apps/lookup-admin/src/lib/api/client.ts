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
  is_active: boolean;
  last_synced_at: string | null;
}

export interface MetaPageOption {
  page_id: string;
  name: string | null;
}

export interface CreateMetaMappingInput {
  org_id: string;
  page_id: string;
  // Omitted entirely (not sent as null) for a page-level row — see
  // MappingFormModal; the service's schema takes either, this keeps the wire
  // payload the same shape the page-level case reads as.
  form_id?: string;
  platform: MetaPlatform;
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

  // 204 No Content — `request` returns undefined for it. Only org_id and
  // is_active are accepted by updateMappingSchema; page_id/form_id/platform are
  // immutable by design (they are the row's identity), so an edit that needs to
  // change those is a deactivate plus a new row.
  update: (tenantId: string, mappingId: string, body: { org_id?: string; is_active?: boolean }) =>
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
  matched_keyword: string | null;
  confirmed_by: string | null;
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

export interface CampaignSyncResult {
  fetched: number;
  inserted: number;
  suggested: number;
  unmapped: number;
  confirmed_untouched: number;
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
  // The token that would be (or was) added to the type's match_keywords, or
  // null when nothing matched. Populated on every dry run this client makes
  // (learn_keyword is always sent as true on the preview call, which writes
  // nothing regardless) purely so the modal can show the admin what learning
  // would add before they decide whether to actually opt in.
  learned_keyword: string | null;
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
  learn_keyword?: boolean;
}

export const metaCampaigns = {
  list: (tenantId: string) =>
    request<{ success: true; data: MetaCampaignRow[] }>(
      `/meta/campaigns?tenant_id=${encodeURIComponent(tenantId)}`,
    ),

  sync: (tenantId: string) =>
    request<{ success: true; data: CampaignSyncResult }>(
      `/meta/campaigns/sync?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST' },
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
// listed here are the selected tenant's — the ids the confirm dialog and
// OrgAccessPanel then write are ones that tenant's RLS accepts.
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

export const campaignTypes = {
  list: (tenantId: string) =>
    request<{ success: true; data: CampaignTypeRow[] }>(
      `/campaign-types?tenant_id=${encodeURIComponent(tenantId)}`,
    ),
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
  campaign_type_label: string | null;
}

export interface CreatePullRunInput {
  org_ids?: string[];
  page_ids?: string[];
  campaign_ids?: string[];
  since: string;
  until?: string;
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
  // Written by the worker when an Apply pass finishes: that PASS's tallies. After
  // an interrupted-then-resumed Apply, `apply_summary` on the run is the
  // whole-run truth.
  apply: PullApplyResult;
}

// apply_queued: Apply was pressed and is waiting for the server's worker. Apply
// runs in the background like the pull itself, so both it and `applying` are
// in-flight states the screen keeps polling through.
export type PullRunLifecycleStatus =
  | 'queued' | 'running' | 'completed' | 'failed' | 'apply_queued' | 'applying' | 'applied';

export interface PullRunStatus {
  id: string;
  status: PullRunLifecycleStatus;
  filters: {
    org_ids: string[];
    page_ids: string[];
    campaign_ids: string[];
    since: string;
    until: string | null;
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
  importable: number;
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
  latestRun: (tenantId: string) =>
    request<{ success: true; data: { run_id: string; status: PullRunLifecycleStatus } | null }>(
      `/meta/lead-pull/runs/latest?tenant_id=${encodeURIComponent(tenantId)}`,
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
export type RerunSkipReason = 'no_weighted_users' | 'no_department_match' | 'no_capable_users';

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
  // Per-campaign-type weights (schema 1.49.0) — a mapping with no active pool
  // membership comes back with an empty array, not a scalar 0.
  weights: Array<{ campaign_type_id: string; campaign_type: string; campaign_type_label: string; weight: number }>;
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
