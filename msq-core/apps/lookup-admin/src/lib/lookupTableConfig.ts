import { RESERVED_ROLE_RANK } from '@platform/rbac';
import { RESERVED_LEAVE_REQUEST_STATUS_NAMES } from '@platform/authz';

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'fk' | 'date' | 'time';

export type FormValues = Record<string, string | number | boolean>;

// Describes where an 'fk' field's option list comes from and how it chains
// off another field on the same form. Replaces the old `selectOptionsFrom`
// string (which always fetched the whole parent table with no dependency
// awareness) and the hardcoded country/state/city cascade.
export interface FkConfig {
  // A /lookups/{table} slug — the common case (e.g. 'lead-stage', 'org-types').
  table?: string;
  // Non-/lookups sources: the geo cascade backing country_id/state_id/city_id,
  // and iam.departments, which is tenant-scoped and has its own route.
  endpoint?: 'geo-countries' | 'geo-states' | 'geo-cities' | 'departments' | 'orgs';
  // Sibling field key that must have a value before this one can fetch/enable.
  // Chains to any depth: state_id dependsOn country_id, city_id dependsOn state_id.
  dependsOn?: string;
  // Whether the parent table takes the form's tenant_id/org_id. Global parents
  // (org-types, tenant-domains, tenants, …) must NOT receive one — the
  // backend 400s a tenant_id it doesn't expect just as readily as it rejects
  // a missing one on a tenant-scoped table. 'org' is for a parent that is
  // itself scope: 'org' (holidays.calendar_id -> holiday-calendars) — it needs
  // BOTH tenant_id (pins the admin write RLS session) and org_id (the actual
  // filter), same as the child form's own request.
  scope?: 'tenant' | 'global' | 'org';
  labelFrom?: (row: Record<string, unknown>) => string;
}

export interface LookupFieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  fk?: FkConfig;
}

// Mirrors the left-nav grouping: which module owns a table, matched to the
// backend schema it lives in (entity./iam. = platform, lms./marketing. = lms,
// hr. = hr, task. = tasks). Departments and user-roles are grouped under
// 'capabilities' since they're the role side of the capabilities admin screen,
// not a plain lookup — see MODULES below.
export type ModuleKey = 'platform' | 'lms' | 'hr' | 'tasks' | 'capabilities';

export interface LookupTableDef {
  slug: string;
  title: string;
  description: string;
  module: ModuleKey;
  fields: LookupFieldConfig[];
  // Ownership level of a row, in ascending narrowness. Defaults to 'global'
  // (org-types, tenant-domains, tenants itself, …) when omitted.
  //  - 'tenant': rows belong to a tenant (task.task_statuses/task_priorities,
  //    the hr/lms/task lookup catalogs, …) — the page requires a tenant
  //    selection before rows can be listed/created/edited.
  //  - 'org': rows belong to one organization within a tenant
  //    (hr.designations) — the page requires BOTH a tenant and an org
  //    selection; the two navbar switchers cascade (see
  //    components/shell/OrgScopeSwitcher.tsx).
  scope?: 'global' | 'tenant' | 'org';
  // Rows whose `rank` is fixed by the platform, keyed by the row's `name`.
  // Declared here rather than special-cased inside the form components, so the
  // shared Create/Edit modals stay config-driven.
  reservedRanks?: Readonly<Record<string, number>>;
  // Rows whose `name` is a machine vocabulary the platform branches on: the
  // Edit modal locks the name field and withdraws Deactivate for them. Same
  // "config declares, modal reacts" shape as reservedRanks above. Cosmetic —
  // the owning service re-asserts it on write.
  reservedNames?: readonly string[];
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  description: string;
}

export const MODULES: ModuleDef[] = [
  { key: 'platform', label: 'Platform', description: 'Tenants, organizations, and platform-wide classifications.' },
  { key: 'lms', label: 'LMS', description: 'Leads, marketing, and CRM pipeline lookups.' },
  { key: 'hr', label: 'HRMS', description: 'Leave, employment, and attendance lookups.' },
  { key: 'tasks', label: 'Tasks', description: 'Task workflow and priority lookups.' },
  { key: 'capabilities', label: 'Capabilities', description: 'Roles, capability grants, and tenant/org role assignment.' },
];

const NAME_LABEL_FIELDS: LookupFieldConfig[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'label', label: 'Label', type: 'text', required: true },
];

const DESCRIPTION_FIELD: LookupFieldConfig = { key: 'description', label: 'Description', type: 'textarea' };

export const TABLE_CONFIG: Record<string, LookupTableDef> = {
  'org-types': {
    slug: 'org-types',
    title: 'Org Types',
    description: 'Classifications for organizations within a tenant.',
    module: 'platform',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'tenant-domains': {
    slug: 'tenant-domains',
    title: 'Tenant Domains',
    description: 'Business domains tenants can be categorized under.',
    module: 'platform',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  // ── Geography ─────────────────────────────────────────────────────────────
  // Each tenant curates the places it actually operates in. The rows start as
  // a clone of the platform template (entity.seed_tenant_geo) and the tenant
  // adds/deactivates from there — which is why these are scope: 'tenant' and
  // why there is no delete: removing a place is is_active = false, since
  // branches and leads reference it ON DELETE RESTRICT.
  //
  // The country -> state -> city cascade uses the same fk endpoints the
  // organizations form below does.
  'geo-countries': {
    slug: 'geo-countries',
    title: 'Countries',
    description: 'Countries this tenant operates in.',
    module: 'platform',
    scope: 'tenant',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'iso_code', label: 'ISO Code', type: 'text', required: true },
      DESCRIPTION_FIELD,
    ],
  },
  'geo-states': {
    slug: 'geo-states',
    title: 'States',
    description: 'States/regions this tenant operates in.',
    module: 'platform',
    scope: 'tenant',
    fields: [
      { key: 'country_id', label: 'Country', type: 'fk', required: true, fk: { endpoint: 'geo-countries' } },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text' },
      DESCRIPTION_FIELD,
    ],
  },
  'geo-cities': {
    slug: 'geo-cities',
    title: 'Cities',
    description: 'Cities this tenant operates in. Individual branches live under Organizations.',
    module: 'platform',
    scope: 'tenant',
    // No country step here: a tenant has a handful of states, so the state
    // list is short enough to pick from directly, and adding a country_id
    // field would put a key on the form that geo.cities has no column for.
    fields: [
      { key: 'state_id', label: 'State', type: 'fk', required: true, fk: { endpoint: 'geo-states' } },
      { key: 'name', label: 'Name', type: 'text', required: true },
      DESCRIPTION_FIELD,
    ],
  },
  'tenant-plan-types': {
    slug: 'tenant-plan-types',
    title: 'Tenant Plan Types',
    description: 'Subscription plan tiers available to tenants.',
    module: 'platform',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  // Listed before user-roles because it is that form's required parent: with no
  // department a tenant's role list cannot be extended at all.
  'departments': {
    slug: 'departments',
    title: 'Departments',
    description: 'Departments roles are grouped under. Leave the org blank for a tenant-wide department.',
    module: 'capabilities',
    scope: 'tenant',
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      // Optional: NULL org_id = shared by every org in the tenant
      // (iam.departments, db_scripts/02_tables_core.sql).
      { key: 'org_id', label: 'Organization', type: 'fk', fk: { endpoint: 'orgs' } },
    ],
  },
  'user-roles': {
    slug: 'user-roles',
    title: 'User Roles',
    description: 'Roles assignable to users, ordered by rank.',
    module: 'capabilities',
    // Every role belongs to a tenant since _migrations/23 — super_admin is the
    // one global row and admin-service filters it out of this list entirely, so
    // it can never be handed out from here.
    scope: 'tenant',
    fields: [
      { key: 'department_id', label: 'Department', type: 'fk', required: true, fk: { endpoint: 'departments' } },
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'rank', label: 'Rank', type: 'number', required: true },
    ],
    // read_only / org_admin / tenant_admin exist per tenant and are editable
    // here like any other row, but their rank is a platform contract:
    // platform_role derivation and PG-role selection resolve off it. The form
    // locks the field to these values; admin-service re-asserts them on write.
    reservedRanks: RESERVED_ROLE_RANK,
  },
  'lead-stage': {
    slug: 'lead-stage',
    title: 'Lead Stages',
    description: 'Pipeline stages a lead can move through.',
    module: 'lms',
    scope: 'tenant',
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
      { key: 'followup_required', label: 'Follow-up Required', type: 'boolean' },
      { key: 'is_rejected', label: 'Is Rejected', type: 'boolean' },
      { key: 'is_terminated', label: 'Is Terminated', type: 'boolean' },
    ],
  },
  'lead-stage-outcome': {
    slug: 'lead-stage-outcome',
    title: 'Lead Stage Outcomes',
    description: 'Outcomes recordable against a specific lead stage.',
    module: 'lms',
    scope: 'tenant',
    fields: [
      ...NAME_LABEL_FIELDS,
      { key: 'stage_id', label: 'Stage', type: 'fk', required: true, fk: { table: 'lead-stage', scope: 'tenant' } },
      DESCRIPTION_FIELD,
      { key: 'requires_comment', label: 'Requires Comment', type: 'boolean' },
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'interaction-types': {
    slug: 'interaction-types',
    title: 'Interaction Types',
    description: 'Types of interactions logged against a lead.',
    module: 'lms',
    scope: 'tenant',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'follow-up-statuses': {
    slug: 'follow-up-statuses',
    title: 'Follow-up Statuses',
    description: 'Statuses a scheduled follow-up can be in.',
    module: 'lms',
    scope: 'tenant',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'lead-sources': {
    slug: 'lead-sources',
    title: 'Lead Sources',
    description: 'Where a lead originated from.',
    module: 'lms',
    scope: 'tenant',
    fields: [...NAME_LABEL_FIELDS],
  },
  'marketing-platforms': {
    slug: 'marketing-platforms',
    title: 'Marketing Platforms',
    description: 'Ad platforms used to run marketing campaigns.',
    module: 'lms',
    scope: 'tenant',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'campaign-statuses': {
    slug: 'campaign-statuses',
    title: 'Campaign Statuses',
    description: 'Lifecycle statuses for marketing campaigns.',
    module: 'lms',
    scope: 'tenant',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'task-statuses': {
    slug: 'task-statuses',
    title: 'Task Statuses',
    description: 'Workflow statuses a task can be in, per tenant (tasks module).',
    module: 'tasks',
    scope: 'tenant',
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'is_terminal', label: 'Is Terminal', type: 'boolean' },
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'task-priorities': {
    slug: 'task-priorities',
    title: 'Task Priorities',
    description: 'Priority levels a task can be assigned, per tenant (tasks module).',
    module: 'tasks',
    scope: 'tenant',
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'leave-types': {
    slug: 'leave-types',
    title: 'Leave Types',
    description: 'Categories of leave employees can request, per tenant (HR module).',
    module: 'hr',
    scope: 'tenant',
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'is_paid', label: 'Is Paid', type: 'boolean' },
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'employment-types': {
    slug: 'employment-types',
    title: 'Employment Types',
    description: 'Employment classifications for employees, per tenant (HR module).',
    module: 'hr',
    scope: 'tenant',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'attendance-statuses': {
    slug: 'attendance-statuses',
    title: 'Attendance Statuses',
    description: 'Statuses an attendance day can resolve to, per tenant (HR module).',
    module: 'hr',
    scope: 'tenant',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'designations': {
    slug: 'designations',
    title: 'Designations',
    description: 'Job titles employees can hold, per organization (HR module).',
    module: 'hr',
    scope: 'org',
    // hr.designations has no label/description/sort_order — just a name.
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  },
  'holiday-calendars': {
    slug: 'holiday-calendars',
    title: 'Holiday Calendars',
    description: 'Named yearly holiday lists, per organization (HR module).',
    module: 'hr',
    scope: 'org',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'year', label: 'Year', type: 'number', required: true },
    ],
  },
  'holidays': {
    slug: 'holidays',
    title: 'Holidays',
    description: 'Individual holiday dates within a calendar, per organization (HR module).',
    module: 'hr',
    scope: 'org',
    fields: [
      { key: 'calendar_id', label: 'Calendar', type: 'fk', required: true, fk: { table: 'holiday-calendars', scope: 'org' } },
      { key: 'holiday_date', label: 'Date', type: 'date', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'is_optional', label: 'Optional', type: 'boolean' },
    ],
  },
  'shifts': {
    slug: 'shifts',
    title: 'Shifts',
    description: 'Work shift definitions, per organization (HR module).',
    module: 'hr',
    scope: 'org',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'start_time', label: 'Start Time', type: 'time', required: true },
      { key: 'end_time', label: 'End Time', type: 'time', required: true },
      { key: 'grace_minutes', label: 'Grace Minutes', type: 'number' },
      { key: 'min_half_day_minutes', label: 'Min. Half-Day Minutes', type: 'number' },
      { key: 'min_full_day_minutes', label: 'Min. Full-Day Minutes', type: 'number' },
      { key: 'is_night_shift', label: 'Night Shift', type: 'boolean' },
      // Split-shift segments (hr.shift_segments) are a child grid of their
      // own — out of scope here; is_split is shown but not yet paired with a
      // segments editor.
      { key: 'is_split', label: 'Split Shift', type: 'boolean' },
    ],
  },
  'leave-request-statuses': {
    slug: 'leave-request-statuses',
    title: 'Leave Request Statuses',
    description: 'Statuses a leave request moves through, per tenant (HR module).',
    module: 'hr',
    scope: 'tenant',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
    // Unlike its three sibling HR lookups, the `name` here is a machine
    // vocabulary: hr.set_leave_request_is_open() derives is_open from
    // name IN ('pending','approved') and the approve/reject/cancel paths resolve
    // their target status by name. Relabelling is fine; renaming is not.
    reservedNames: RESERVED_LEAVE_REQUEST_STATUS_NAMES,
  },
  'tenants': {
    slug: 'tenants',
    title: 'Tenants',
    description: 'Top-level tenant accounts on the platform.',
    module: 'platform',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'domain_id', label: 'Domain', type: 'fk', required: true, fk: { table: 'tenant-domains', scope: 'global' } },
      { key: 'plan_type_id', label: 'Plan Type', type: 'fk', required: true, fk: { table: 'tenant-plan-types', scope: 'global' } },
    ],
  },
  'capi-event-types': {
    slug: 'capi-event-types',
    title: 'CAPI Event Types',
    description: 'Meta Conversion API event types a lead stage transition can fire.',
    module: 'lms',
    // Global catalog (ext.meta_capi_event_types) — the id is a SMALLINT
    // identity column, the only one in the console; admin-service parses the
    // PATCH :id param accordingly. `code` is this table's identity field —
    // there is no `name` column — but the service aliases it to `name` in
    // every API response, so the shared grid's synthetic name/label column
    // needs no special case for this one table's shape.
    fields: [
      { key: 'code', label: 'Code', type: 'text', required: true },
      { key: 'label', label: 'Label', type: 'text', required: true },
      DESCRIPTION_FIELD,
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'organizations': {
    slug: 'organizations',
    title: 'Organizations',
    description: 'Branches/locations under a tenant.',
    module: 'platform',
    fields: [
      { key: 'tenant_id', label: 'Tenant', type: 'fk', required: true, fk: { table: 'tenants', scope: 'global' } },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'legal_entity_name', label: 'Legal Entity Name', type: 'text' },
      { key: 'brand_name', label: 'Brand Name', type: 'text' },
      { key: 'org_type_id', label: 'Org Type', type: 'fk', required: true, fk: { table: 'org-types', scope: 'global' } },
      { key: 'address_line1', label: 'Address Line 1', type: 'text' },
      { key: 'address_line2', label: 'Address Line 2', type: 'text' },
      { key: 'pincode', label: 'Pincode', type: 'text' },
      { key: 'country_id', label: 'Country', type: 'fk', fk: { endpoint: 'geo-countries' } },
      { key: 'state_id', label: 'State', type: 'fk', fk: { endpoint: 'geo-states', dependsOn: 'country_id' } },
      { key: 'city_id', label: 'City', type: 'fk', fk: { endpoint: 'geo-cities', dependsOn: 'state_id' } },
      { key: 'timezone', label: 'Timezone', type: 'text' },
    ],
  },
};

// Card-pane grouping for the module nav (app/dashboard/m/[module]/page.tsx).
// Departments and user-roles (module: 'capabilities') work today as ordinary
// lookup cards through the same [table] route; once the capability-matrix and
// tenant/org assignment screens land they'll gain sibling tabs alongside this
// card grid rather than replacing it.
export function tablesByModule(module: ModuleKey): LookupTableDef[] {
  return Object.values(TABLE_CONFIG).filter((t) => t.module === module);
}
