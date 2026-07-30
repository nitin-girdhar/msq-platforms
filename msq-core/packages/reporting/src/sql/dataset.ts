// ── Dataset definitions: the whitelist ───────────────────────────────────────
// A DatasetDef is the ONLY place a SQL identifier is ever authored. Everything
// the compiler emits comes from a `SQL` fragment written here, in source, by a
// developer — never from a request.
//
// AUTHORING RULES (read before adding a dataset):
//
//  1. Build every fragment with the `sql` template tag from drizzle-orm.
//     Interpolate NOTHING that came from outside this file. If you find
//     yourself reaching for `sql.raw`, stop — that is the one call this package
//     has a test forbidding.
//
//  2. `from` should be a VIEW, not a table. The views are `security_invoker`,
//     so underlying-table RLS applies to the caller (see db_scripts/06_rls.sql)
//     and the report inherits row filtering for free. Every relation named here
//     also needs an explicit `GRANT SELECT … TO <product>_svc` in
//     db_scripts/04_roles_and_grants.sql — the grants are enumerated per login,
//     so a missing one is a runtime permission error, not a silent widening.
//
//  3. `scope.org` is REQUIRED and is always ANDed. There is no dataset without
//     an org column, because there is no report that may cross orgs.
//
//  4. Declare `aggs` per measure honestly. SUM over a surrogate key or a status
//     id is arithmetic on an identifier: offering it produces a number that
//     looks like data and is noise.
//
//  5. Set `requiresDateRange: true` on anything that grows without bound. An
//     unbounded GROUP BY over a wide multi-join view will seq-scan, and
//     statement_timeout will turn that into a user-visible failure at exactly
//     the moment the org gets big enough to care.

import type { SQL } from 'drizzle-orm';
import type { CapabilityKey } from '@platform/rbac';
import type { AggFn, DateBucket, FieldKind, MeasureFormat, ReportSpec } from '../spec/types.js';

export interface DimensionDef {
  /** Stable API name. The spec addresses this; it is matched exactly and never
   *  emitted. Renaming one breaks every saved report that used it, so treat it
   *  as a public identifier: deprecate, never rename. */
  key: string;
  label: string;
  kind: FieldKind;
  /** The grouping expression. Source-authored. */
  expr: SQL;
  /** Human label when `expr` is a surrogate id. The reporting views already
   *  denormalise this (vw_dashboard_leads carries both `stage` and
   *  `stage_label`), so prefer picking the label column over adding a join. */
  labelExpr?: SQL;
  /** Ordering expression for the dimension's own keys — e.g. a lookup's
   *  `sort_order`, so stages come out in pipeline order rather than
   *  alphabetically. Defaults to `expr`. */
  sortExpr?: SQL;
  /** Permitted date buckets. Must be empty/absent for non-temporal kinds; the
   *  compiler rejects a bucket on a dimension that does not list it. */
  buckets?: readonly DateBucket[];
  /** Default true. False ⇒ filter-only: legal in `filters`, rejected on a
   *  shelf. Use for high-cardinality keys worth filtering but never grouping. */
  groupable?: boolean;
  /** Default true. */
  filterable?: boolean;
  /** 'high' tells the UI to require a topN or refuse to chart. Advisory only —
   *  the cell caps are what actually protect the server. */
  cardinality?: 'low' | 'high';
  /** Hide from the palette (and reject in a spec) unless the actor holds this. */
  requiresCapability?: CapabilityKey;
  description?: string;
}

export interface MeasureDef {
  /** '*' is reserved: the COUNT(*) measure. Every dataset should expose it. */
  key: string;
  label: string;
  /** The bare value expression. The aggregate wraps it — do NOT write the
   *  aggregate here, or `agg` becomes a lie and SUM(SUM(x)) becomes possible. */
  expr: SQL;
  /** Aggregations legal for this field. Enforced against the spec. */
  aggs: readonly AggFn[];
  kind: 'number' | 'uuid' | 'string';
  defaultFormat?: MeasureFormat;
  requiresCapability?: CapabilityKey;
  description?: string;
}

/**
 * The columns that make a dataset safely scopeable.
 *
 * These are NOT optional conveniences — they are how the compiler narrows rows
 * to the actor. A dataset that omits `owner` cannot serve an actor whose
 * capability resolves to scope 'own', and the compiler will 403 rather than
 * quietly hand them the whole org.
 */
export interface ScopeColumns {
  /** REQUIRED. Always ANDed against the caller's org_id. */
  org: SQL;
  /** Needed to serve a tenant_admin. Absent ⇒ tenant-wide requests are
   *  rejected for this dataset. */
  tenant?: SQL;
  /** Row-owner user id, for scope 'own'. */
  owner?: SQL;
  /** User id compared against the actor's team, for scope 'team'. */
  teamMember?: SQL;
  /** Always ANDed. Typically `NOT is_deleted`. */
  basePredicate?: SQL;
}

export interface DatasetCaps {
  maxGroups?: number;
  timeoutMs?: number;
}

export interface DatasetDef {
  /** Registry key, e.g. 'lms.leads'. Referenced by ReportSpec.dataset and
   *  persisted in report_definitions.dataset_key — a public identifier. */
  key: string;
  label: string;
  description: string;
  product: 'lms' | 'hr' | 'task';
  /** The FROM clause. A view, per rule 2. */
  from: SQL;
  dimensions: readonly DimensionDef[];
  measures: readonly MeasureDef[];
  scope: ScopeColumns;
  /** Gate to list or query this dataset at all. */
  capability: CapabilityKey;
  /** Operation key handed to resolveScope() to narrow rows. Omit only for a
   *  dataset that is inherently org-wide for everyone who can see it. */
  scopeOperation?: CapabilityKey;
  /** Reject a spec with no date-range filter on `dateField`. */
  requiresDateRange?: boolean;
  /** Dimension key the required range applies to. Must name a temporal,
   *  filterable dimension. */
  dateField?: string;
  /** Window the UI pre-fills. Default 90. */
  defaultWindowDays?: number;
  caps?: DatasetCaps;
  /** Suggested starting spec, merged over specForDataset()'s guess. */
  defaultSpec?: Partial<ReportSpec>;
}

// ── Lookup helpers. Exact-match only — this is the whitelist gate. ────────────

export function findDimension(def: DatasetDef, key: string): DimensionDef | undefined {
  return def.dimensions.find((d) => d.key === key);
}

export function findMeasure(def: DatasetDef, key: string): MeasureDef | undefined {
  return def.measures.find((m) => m.key === key);
}

export function isGroupable(d: DimensionDef): boolean {
  return d.groupable !== false;
}

export function isFilterable(d: DimensionDef): boolean {
  return d.filterable !== false;
}
