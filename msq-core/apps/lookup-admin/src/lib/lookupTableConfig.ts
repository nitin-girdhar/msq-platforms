export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'geo-select';

export interface LookupFieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  selectOptionsFrom?: string;
}

export interface LookupTableDef {
  slug: string;
  title: string;
  description: string;
  fields: LookupFieldConfig[];
  // When true, rows belong to a tenant (task.task_statuses/task_priorities and
  // the hr/lms/task lookup catalogs, per db_scripts/22) — the page requires a
  // tenant selection before rows can be listed/created/edited.
  tenantScoped?: boolean;
}

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
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'tenant-domains': {
    slug: 'tenant-domains',
    title: 'Tenant Domains',
    description: 'Business domains tenants can be categorized under.',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'tenant-plan-types': {
    slug: 'tenant-plan-types',
    title: 'Tenant Plan Types',
    description: 'Subscription plan tiers available to tenants.',
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'user-roles': {
    slug: 'user-roles',
    title: 'User Roles',
    description: 'Roles assignable to users, ordered by rank.',
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'rank', label: 'Rank', type: 'number', required: true },
    ],
  },
  'lead-stage': {
    slug: 'lead-stage',
    title: 'Lead Stages',
    description: 'Pipeline stages a lead can move through.',
    tenantScoped: true,
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
    tenantScoped: true,
    fields: [
      ...NAME_LABEL_FIELDS,
      { key: 'stage_id', label: 'Stage', type: 'select', required: true, selectOptionsFrom: 'lead-stage' },
      DESCRIPTION_FIELD,
      { key: 'requires_comment', label: 'Requires Comment', type: 'boolean' },
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'interaction-types': {
    slug: 'interaction-types',
    title: 'Interaction Types',
    description: 'Types of interactions logged against a lead.',
    tenantScoped: true,
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'follow-up-statuses': {
    slug: 'follow-up-statuses',
    title: 'Follow-up Statuses',
    description: 'Statuses a scheduled follow-up can be in.',
    tenantScoped: true,
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'lead-sources': {
    slug: 'lead-sources',
    title: 'Lead Sources',
    description: 'Where a lead originated from.',
    tenantScoped: true,
    fields: [...NAME_LABEL_FIELDS],
  },
  'marketing-platforms': {
    slug: 'marketing-platforms',
    title: 'Marketing Platforms',
    description: 'Ad platforms used to run marketing campaigns.',
    tenantScoped: true,
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'campaign-statuses': {
    slug: 'campaign-statuses',
    title: 'Campaign Statuses',
    description: 'Lifecycle statuses for marketing campaigns.',
    tenantScoped: true,
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'task-statuses': {
    slug: 'task-statuses',
    title: 'Task Statuses',
    description: 'Workflow statuses a task can be in, per tenant (tasks module).',
    tenantScoped: true,
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
    tenantScoped: true,
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
    tenantScoped: true,
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
    tenantScoped: true,
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'attendance-statuses': {
    slug: 'attendance-statuses',
    title: 'Attendance Statuses',
    description: 'Statuses an attendance day can resolve to, per tenant (HR module).',
    tenantScoped: true,
    fields: [...NAME_LABEL_FIELDS, DESCRIPTION_FIELD],
  },
  'lms-roles': {
    slug: 'lms-roles',
    title: 'LMS Roles',
    description: 'Roles within the leads/CRM module, per tenant.',
    tenantScoped: true,
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'rank', label: 'Rank', type: 'number', required: true },
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'hr-roles': {
    slug: 'hr-roles',
    title: 'HR Roles',
    description: 'Roles within the HR module, per tenant.',
    tenantScoped: true,
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'rank', label: 'Rank', type: 'number', required: true },
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'task-roles': {
    slug: 'task-roles',
    title: 'Task Roles',
    description: 'Roles within the tasks module, per tenant.',
    tenantScoped: true,
    fields: [
      ...NAME_LABEL_FIELDS,
      DESCRIPTION_FIELD,
      { key: 'rank', label: 'Rank', type: 'number', required: true },
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
    ],
  },
  'tenants': {
    slug: 'tenants',
    title: 'Tenants',
    description: 'Top-level tenant accounts on the platform.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'domain_id', label: 'Domain', type: 'select', required: true, selectOptionsFrom: 'tenant-domains' },
      { key: 'plan_type_id', label: 'Plan Type', type: 'select', required: true, selectOptionsFrom: 'tenant-plan-types' },
    ],
  },
  'organizations': {
    slug: 'organizations',
    title: 'Organizations',
    description: 'Branches/locations under a tenant.',
    fields: [
      { key: 'tenant_id', label: 'Tenant', type: 'select', required: true, selectOptionsFrom: 'tenants' },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'legal_entity_name', label: 'Legal Entity Name', type: 'text' },
      { key: 'brand_name', label: 'Brand Name', type: 'text' },
      { key: 'org_type_id', label: 'Org Type', type: 'select', required: true, selectOptionsFrom: 'org-types' },
      { key: 'address_line1', label: 'Address Line 1', type: 'text' },
      { key: 'address_line2', label: 'Address Line 2', type: 'text' },
      { key: 'pincode', label: 'Pincode', type: 'text' },
      { key: 'country_id', label: 'Country', type: 'geo-select' },
      { key: 'state_id', label: 'State', type: 'geo-select' },
      { key: 'city_id', label: 'City', type: 'geo-select' },
      { key: 'timezone', label: 'Timezone', type: 'text' },
    ],
  },
};
