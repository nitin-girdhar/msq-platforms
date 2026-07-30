// ── Test fixtures ────────────────────────────────────────────────────────────
// A dataset exercising every DimensionDef/MeasureDef feature, plus helpers to
// render a compiled query to { text, params }.
//
// The `params` array is the assertion that matters throughout this suite. A
// test that only checks the SQL text would pass while a malicious value sat
// inside it; asserting the value landed in `params` is what proves the value
// never became SQL.

import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { CAPABILITY, type CapabilityHolder } from '@platform/rbac';
import type { DatasetDef } from '../sql/dataset.js';
import type { ReportQueryContext } from '../sql/scope.js';
import type { ReportSpec } from '../spec/types.js';

const dialect = new PgDialect();

export interface RenderedQuery {
  text: string;
  params: unknown[];
}

export function render(query: SQL): RenderedQuery {
  const q = dialect.sqlToQuery(query);
  return { text: q.sql, params: [...q.params] };
}

const CLAUSE_ORDER = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT'] as const;
export type ClauseName = (typeof CLAUSE_ORDER)[number];

/**
 * Extract ONE top-level clause from rendered SQL.
 *
 * Slicing from `indexOf('GROUP BY')` to the end of the string sweeps up ORDER BY
 * and LIMIT too, which silently turns "is this expression in the GROUP BY?" into
 * "is it anywhere after it?" — a test that passes for the wrong reason. This
 * bounds the slice at the next clause keyword.
 */
export function clause(text: string, name: ClauseName): string {
  const start = text.indexOf(name);
  if (start === -1) return '';
  const after = start + name.length;
  const ends = CLAUSE_ORDER.slice(CLAUSE_ORDER.indexOf(name) + 1)
    .map((k) => text.indexOf(k, after))
    .filter((i) => i !== -1);
  const end = ends.length > 0 ? Math.min(...ends) : text.length;
  return text.slice(after, end);
}

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const TENANT_ID = '22222222-2222-4222-8222-222222222222';
export const USER_ID = '33333333-3333-4333-8333-333333333333';

/** A dataset covering: labelExpr, sortExpr, all five buckets, a filter-only
 *  dimension, a capability-gated dimension, a high-cardinality dimension, and
 *  measures with disjoint agg allowlists. */
export const leadsDataset: DatasetDef = {
  key: 'test.leads',
  label: 'Test Leads',
  description: 'Fixture dataset.',
  product: 'lms',
  from: sql`test.vw_leads`,
  dimensions: [
    {
      key: 'stage',
      label: 'Stage',
      kind: 'string',
      expr: sql`stage`,
      labelExpr: sql`stage_label`,
      sortExpr: sql`stage_sort`,
      cardinality: 'low',
    },
    { key: 'source', label: 'Source', kind: 'string', expr: sql`source` },
    {
      key: 'created_at',
      label: 'Created',
      kind: 'timestamp',
      expr: sql`created_at`,
      buckets: ['day', 'week', 'month', 'quarter', 'year'],
    },
    {
      key: 'closed_on',
      label: 'Closed',
      kind: 'date',
      expr: sql`closed_on`,
      buckets: ['day', 'month'],
    },
    {
      key: 'assigned_to',
      label: 'Owner',
      kind: 'uuid',
      expr: sql`assigned_to`,
      cardinality: 'high',
    },
    { key: 'score', label: 'Score', kind: 'number', expr: sql`score` },
    { key: 'is_qualified', label: 'Qualified', kind: 'boolean', expr: sql`is_qualified` },
    // Filter-only: legal in filters, rejected on a shelf.
    { key: 'email', label: 'Email', kind: 'string', expr: sql`email`, groupable: false },
    // Capability-gated.
    {
      key: 'deal_band',
      label: 'Deal Band',
      kind: 'string',
      expr: sql`deal_band`,
      requiresCapability: CAPABILITY.LMS_ANALYTICS_ORG_VIEW,
    },
  ],
  measures: [
    { key: '*', label: 'Leads', expr: sql`1`, aggs: ['count'], kind: 'number' },
    {
      key: 'amount',
      label: 'Amount',
      expr: sql`amount`,
      aggs: ['sum', 'avg', 'min', 'max'],
      kind: 'number',
    },
    { key: 'lead_id', label: 'Unique leads', expr: sql`lead_id`, aggs: ['count_distinct'], kind: 'uuid' },
  ],
  scope: {
    org: sql`org_id`,
    tenant: sql`tenant_id`,
    owner: sql`assigned_to`,
    teamMember: sql`assigned_to`,
    basePredicate: sql`NOT is_deleted`,
  },
  capability: CAPABILITY.LMS_ANALYTICS_VIEW,
  scopeOperation: CAPABILITY.LMS_LEADS_VIEW,
};

/** Same dataset with a mandatory date range, for the requiresDateRange tests. */
export const factDataset: DatasetDef = {
  ...leadsDataset,
  key: 'test.facts',
  requiresDateRange: true,
  dateField: 'created_at',
  defaultWindowDays: 30,
};

/** A dataset with no tenant/owner/team columns — the "cannot express that scope"
 *  case that must 403 rather than widen. */
export const narrowDataset: DatasetDef = {
  key: 'test.narrow',
  label: 'Narrow',
  description: 'Org column only.',
  product: 'lms',
  from: sql`test.vw_narrow`,
  dimensions: [{ key: 'stage', label: 'Stage', kind: 'string', expr: sql`stage` }],
  measures: [{ key: '*', label: 'Rows', expr: sql`1`, aggs: ['count'], kind: 'number' }],
  scope: { org: sql`org_id` },
  capability: CAPABILITY.LMS_ANALYTICS_VIEW,
  scopeOperation: CAPABILITY.LMS_LEADS_VIEW,
};

export function actor(...capabilities: string[]): CapabilityHolder {
  return { capabilities };
}

/** An org-scoped analyst: can see the dataset, resolves to scope 'org'. */
export const orgActor = actor(
  CAPABILITY.LMS_ANALYTICS_VIEW,
  CAPABILITY.LMS_LEADS_VIEW,
  CAPABILITY.LMS_LEADS_VIEW_ORG,
);

export const ownActor = actor(
  CAPABILITY.LMS_ANALYTICS_VIEW,
  CAPABILITY.LMS_LEADS_VIEW,
  CAPABILITY.LMS_LEADS_VIEW_OWN,
);

export const teamActor = actor(
  CAPABILITY.LMS_ANALYTICS_VIEW,
  CAPABILITY.LMS_LEADS_VIEW,
  CAPABILITY.LMS_LEADS_VIEW_TEAM,
);

export function ctxFor(
  who: CapabilityHolder,
  overrides: Partial<ReportQueryContext> = {},
): ReportQueryContext {
  return {
    actor: who,
    role: 'org_admin',
    orgId: ORG_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    orgTimezone: 'Asia/Kolkata',
    ...overrides,
  };
}

/** A minimal valid spec against `leadsDataset`, overridable per test. */
export function specFor(overrides: Partial<ReportSpec> = {}): ReportSpec {
  return {
    version: 1,
    dataset: 'test.leads',
    rows: [{ field: 'stage' }],
    columns: [],
    measures: [{ id: 'm1', field: '*', agg: 'count' }],
    filters: [],
    chart: { type: 'bar', encoding: { measures: ['m1'] } },
    ...overrides,
  };
}
