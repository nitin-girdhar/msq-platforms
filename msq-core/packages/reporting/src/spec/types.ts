// ── The report spec: the wire contract between the builder UI and the SQL
// compiler ─────────────────────────────────────────────────────────────────
//
// This file is browser-safe and MUST stay that way: no drizzle, no pg, no
// dataset definitions. It describes what the user asked for, never how to get
// it. The mapping from a spec to SQL lives entirely in ../sql, driven by a
// DatasetDef whose SQL fragments are authored in source.
//
// READ THIS BEFORE ADDING A FIELD: every string in a ReportSpec is untrusted
// input. A field is safe to add only if it is one of
//   (a) a member of a closed `as const` vocabulary declared below, or
//   (b) a key that ../sql resolves against a DatasetDef by exact match, or
//   (c) presentation-only data that never reaches SQL.
// A free-form string that becomes a SQL identifier is how this feature gets a
// CVE. There is no case (d).

// ── Closed vocabularies ─────────────────────────────────────────────────────
// Each of these is a choke point: the compiler keys a Record<T, builder> off
// the value, so a value outside the union cannot produce SQL at all.

export const AGG_FNS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
export type AggFn = (typeof AGG_FNS)[number];

export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export const CHART_TYPES = [
  'table',
  'kpi',
  'line',
  'area',
  'bar',
  'bar_stacked',
  'bar_horizontal',
  'pie',
  'donut',
  'scatter',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** The shape of a dataset field, as far as the spec is concerned. Drives which
 *  filter ops and buckets are legal, and how the UI renders a value editor. */
export const FIELD_KINDS = ['string', 'number', 'date', 'timestamp', 'boolean', 'uuid'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FILTER_OPS = [
  'eq',
  'ne',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_null',
  'is_not_null',
  'contains',
  'starts_with',
  'last_n_days',
  'this_period',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Field kinds that may carry a date bucket, and that `last_n_days` /
 *  `this_period` may target. */
export const TEMPORAL_KINDS: readonly FieldKind[] = ['date', 'timestamp'];

export function isTemporalKind(kind: FieldKind): boolean {
  return TEMPORAL_KINDS.includes(kind);
}

// ── Spec pieces ─────────────────────────────────────────────────────────────

/** A field placed on the row axis or the column axis. */
export interface DimensionRef {
  /** Key into DatasetDef.dimensions. Resolved by exact match; NEVER emitted. */
  field: string;
  /** Legal only when the dimension's kind is temporal AND the bucket is in that
   *  dimension's declared `buckets`. */
  bucket?: DateBucket;
  /** Presentation override. Never reaches SQL. */
  label?: string;
  sort?: DimensionSort;
  /** Keep the top N groups by `topNMeasure` (default: the first measure) and
   *  fold the remainder into a single "Other" group. Applied after aggregation,
   *  in JS — it is a presentation concern, not a LIMIT. */
  topN?: number;
  topNMeasure?: string;
}

export interface DimensionSort {
  /** 'key' sorts by the dimension's own sortExpr (or its value); 'measure'
   *  sorts by an aggregated measure, which is what "biggest first" means. */
  by: 'key' | 'measure';
  /** Required when by === 'measure': a MeasureRef.id from the same spec. */
  measureId?: string;
  dir: SortDir;
}

export const SORT_DIRS = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIRS)[number];

export interface MeasureRef {
  /** Client-generated, stable within one spec. Referenced by ChartEncoding,
   *  DimensionSort and orderBy. Slug-constrained by the zod schema, and STILL
   *  never used as a SQL alias — the compiler aliases positionally (m0, m1, …)
   *  and maps ids to positions in JS. */
  id: string;
  /** Key into DatasetDef.measures. The reserved key '*' means "count rows" and
   *  is legal only with agg 'count'. */
  field: string;
  agg: AggFn;
  label?: string;
  format?: MeasureFormat;
}

export const MEASURE_FORMATS = ['number', 'percent', 'currency', 'duration_minutes'] as const;
export type MeasureFormatKind = (typeof MEASURE_FORMATS)[number];

export interface MeasureFormat {
  kind: MeasureFormatKind;
  decimals?: number;
}

/** Scalar values a filter can bind. Arrays are the clause's `values`, not a
 *  nested value — there is no recursive filter value by design. */
export type FilterValue = string | number | boolean | null;

export interface FilterClause {
  /** Key into DatasetDef.dimensions. The dimension must be `filterable`; it
   *  need NOT be `groupable` (a filter-only field is a legitimate config). */
  field: string;
  op: FilterOp;
  /** Bound as parameters, always. Arity is validated per op:
   *    is_null / is_not_null → 0
   *    between               → 2
   *    in / not_in           → 1..maxFilterValues
   *    last_n_days           → 1 positive integer
   *    this_period           → 0 (uses `bucket`)
   *    everything else       → 1 */
  values?: readonly FilterValue[];
  /** Required by `this_period` ("this month/quarter/year to date"). */
  bucket?: DateBucket;
}

export interface ChartEncoding {
  /** Which row dimension drives the category/x axis. Index into spec.rows.
   *  Defaults to 0. */
  xFromRow?: number;
  /** Measure ids drawn as series (the y values for bar/line/area, the slice
   *  size for pie/donut, the y for scatter). */
  measures: readonly string[];
  /** Scatter only: the measure id on the x axis. */
  xMeasure?: string;
  stacked?: boolean;
  showLegend?: boolean;
  showDataLabels?: boolean;
  yAxisLabel?: string;
  /** Per-series colour, keyed by series key or measure id. Presentation only —
   *  but still validated as a hex colour, because it is rendered into inline
   *  style attributes in scheduled email. */
  colorOverrides?: Readonly<Record<string, string>>;
}

export interface ReportOrderBy {
  /** A MeasureRef.id when kind === 'measure', else a row/column dimension
   *  field key. Resolved to an emitted output position; the compiler writes
   *  `ORDER BY <ordinal>`, so no identifier is ever produced from this. */
  ref: string;
  kind: 'dimension' | 'measure';
  dir: SortDir;
}

export interface ReportSpec {
  version: 1;
  /** Key into the per-product dataset registry. */
  dataset: string;
  /** Pivot ROW shelf. 0..LIMITS.maxRowDims. */
  rows: readonly DimensionRef[];
  /** Pivot COLUMN shelf. 0..LIMITS.maxColumnDims. Simultaneously the chart's
   *  series breakdown — one concept, two renderings. */
  columns: readonly DimensionRef[];
  /** Pivot VALUES shelf. 1..LIMITS.maxMeasures. Never empty: a report with no
   *  measure has nothing to aggregate. */
  measures: readonly MeasureRef[];
  filters: readonly FilterClause[];
  orderBy?: readonly ReportOrderBy[];
  /** Groups to return. Clamped server-side to [1, LIMITS.maxGroups]. */
  limit?: number;
  chart: ReportChartSpec;
  /** IANA zone for date bucketing. Omitted ⇒ the org's timezone
   *  (entity.organizations.timezone), resolved server-side. */
  timezone?: string;
}

export interface ReportChartSpec {
  type: ChartType;
  encoding: ChartEncoding;
}

// ── Chart shape rules ───────────────────────────────────────────────────────
// Which spec shapes a given chart type can actually render. Enforced by the
// zod schema AND surfaced by the UI (ChartTypePicker disables a type and says
// why), so the two must agree — hence one table, consumed by both.

export interface ChartShapeRule {
  minRowDims: number;
  maxRowDims: number;
  maxColumnDims: number;
  minMeasures: number;
  maxMeasures: number;
  /** Scatter needs a second measure for the x axis. */
  requiresXMeasure?: boolean;
}

export const CHART_SHAPE_RULES: Readonly<Record<ChartType, ChartShapeRule>> = {
  // The pivot table renders whatever the shelves hold.
  table: { minRowDims: 0, maxRowDims: 2, maxColumnDims: 1, minMeasures: 1, maxMeasures: 4 },
  // KPI tiles are measures with no breakdown at all.
  kpi: { minRowDims: 0, maxRowDims: 0, maxColumnDims: 0, minMeasures: 1, maxMeasures: 4 },
  line: { minRowDims: 1, maxRowDims: 1, maxColumnDims: 1, minMeasures: 1, maxMeasures: 4 },
  area: { minRowDims: 1, maxRowDims: 1, maxColumnDims: 1, minMeasures: 1, maxMeasures: 4 },
  bar: { minRowDims: 1, maxRowDims: 1, maxColumnDims: 1, minMeasures: 1, maxMeasures: 4 },
  bar_stacked: { minRowDims: 1, maxRowDims: 1, maxColumnDims: 1, minMeasures: 1, maxMeasures: 4 },
  bar_horizontal: { minRowDims: 1, maxRowDims: 1, maxColumnDims: 1, minMeasures: 1, maxMeasures: 4 },
  // A pie encodes one dimension as slices and one measure as size. A second of
  // either has no visual channel left to occupy.
  pie: { minRowDims: 1, maxRowDims: 1, maxColumnDims: 0, minMeasures: 1, maxMeasures: 1 },
  donut: { minRowDims: 1, maxRowDims: 1, maxColumnDims: 0, minMeasures: 1, maxMeasures: 1 },
  scatter: {
    minRowDims: 1,
    maxRowDims: 1,
    maxColumnDims: 1,
    minMeasures: 1,
    maxMeasures: 1,
    requiresXMeasure: true,
  },
} as const;

/** Why a spec cannot render as its chart type, or null when it can. Shared by
 *  the zod refinement and the UI so the message is identical in both. */
export function chartShapeError(spec: ReportSpec): string | null {
  const rule = CHART_SHAPE_RULES[spec.chart.type];
  const rows = spec.rows.length;
  const cols = spec.columns.length;
  const measures = spec.measures.length;

  if (rows < rule.minRowDims) {
    return `A ${spec.chart.type} chart needs at least ${rule.minRowDims} row field.`;
  }
  if (rows > rule.maxRowDims) {
    return `A ${spec.chart.type} chart supports at most ${rule.maxRowDims} row field(s).`;
  }
  if (cols > rule.maxColumnDims) {
    return rule.maxColumnDims === 0
      ? `A ${spec.chart.type} chart has no series channel — remove the column field.`
      : `A ${spec.chart.type} chart supports at most ${rule.maxColumnDims} column field(s).`;
  }
  if (measures < rule.minMeasures) {
    return `A ${spec.chart.type} chart needs at least ${rule.minMeasures} value.`;
  }
  if (measures > rule.maxMeasures) {
    return `A ${spec.chart.type} chart supports at most ${rule.maxMeasures} value(s).`;
  }
  if (rule.requiresXMeasure && spec.chart.encoding.xMeasure === undefined) {
    return `A ${spec.chart.type} chart needs a second value for its x axis.`;
  }
  return null;
}

// ── Arity of a filter op ────────────────────────────────────────────────────
// One table, consumed by the zod schema (reject early, with a good message) and
// by the compiler (defence in depth — it re-checks rather than trusting that
// validation ran).

export interface FilterArity {
  min: number;
  /** null = unbounded up to LIMITS.maxFilterValues. */
  max: number | null;
  /** Op targets a temporal field only. */
  temporalOnly?: boolean;
  /** Op targets a string field only. */
  textOnly?: boolean;
  requiresBucket?: boolean;
}

export const FILTER_ARITY: Readonly<Record<FilterOp, FilterArity>> = {
  eq: { min: 1, max: 1 },
  ne: { min: 1, max: 1 },
  in: { min: 1, max: null },
  not_in: { min: 1, max: null },
  gt: { min: 1, max: 1 },
  gte: { min: 1, max: 1 },
  lt: { min: 1, max: 1 },
  lte: { min: 1, max: 1 },
  between: { min: 2, max: 2 },
  is_null: { min: 0, max: 0 },
  is_not_null: { min: 0, max: 0 },
  contains: { min: 1, max: 1, textOnly: true },
  starts_with: { min: 1, max: 1, textOnly: true },
  last_n_days: { min: 1, max: 1, temporalOnly: true },
  this_period: { min: 0, max: 0, temporalOnly: true, requiresBucket: true },
} as const;
