// ── @platform/reporting ──────────────────────────────────────────────────────
// The generic reporting engine: a spec contract, a whitelist SQL compiler, and
// the pivot/format helpers both the UI and the scheduled-email renderer share.
//
// THIS ENTRY IS BROWSER-SAFE and must stay that way. It is imported by
// @platform/ui-kit, which Next transpiles into client bundles. Nothing here may
// reach drizzle, `postgres`, `node:*`, or a DatasetDef — the moment it does, a
// dataset's SQL fragments ship to the browser.
//
//   import { … }              from '@platform/reporting'        ← this file
//   import { buildReportQuery } from '@platform/reporting/sql'  ← server only
//
// Never add domain knowledge here: no dataset keys, no capability keys, no
// endpoint paths, nothing that names LMS or HR. Those live in each product
// service's own dataset registry.

// ── The spec contract ──
export {
  AGG_FNS,
  CHART_SHAPE_RULES,
  CHART_TYPES,
  DATE_BUCKETS,
  FIELD_KINDS,
  FILTER_ARITY,
  FILTER_OPS,
  MEASURE_FORMATS,
  SORT_DIRS,
  TEMPORAL_KINDS,
  chartShapeError,
  isTemporalKind,
  type AggFn,
  type ChartEncoding,
  type ChartShapeRule,
  type ChartType,
  type DateBucket,
  type DimensionRef,
  type DimensionSort,
  type FieldKind,
  type FilterArity,
  type FilterClause,
  type FilterOp,
  type FilterValue,
  type MeasureFormat,
  type MeasureFormatKind,
  type MeasureRef,
  type ReportChartSpec,
  type ReportOrderBy,
  type ReportSpec,
  type SortDir,
} from './spec/types.js';

// ── Caps ──
export { LIMITS, clampLimit } from './spec/limits.js';

// ── Results ──
export {
  CELL_KEY_SEP,
  OTHER_GROUP_LABEL,
  cellKey,
  dimKey,
  parseCellKey,
  type ReportCell,
  type ReportResult,
  type ReportResultColumn,
  type ReportResultMeta,
  type ReportSeries,
} from './spec/result.js';

// ── The client-facing dataset view ──
export type { DatasetMeta, DimensionMeta, MeasureMeta } from './spec/dataset-meta.js';

// ── Validation ──
export {
  isValidTimeZone,
  parseReportSpec,
  reportSpecSchema,
  type SpecParseFailure,
  type SpecParseResult,
  type SpecParseSuccess,
} from './spec/schema.js';

// ── Starting points / spec surgery ──
export {
  COUNT_ROWS_FIELD,
  canAcceptOnShelf,
  defaultDateFilter,
  emptySpec,
  nextMeasureId,
  shelfCapacity,
  specForDataset,
  type Shelf,
} from './spec/defaults.js';

// ── Long → wide ──
export {
  LONG_KEYS,
  applyTopN,
  countCells,
  grandTotals,
  measureLabel,
  pivotRows,
  type LongRow,
  type PivotOutput,
  type WideRow,
} from './spec/pivot.js';
