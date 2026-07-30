// ── @platform/reporting/sql — SERVER ONLY ────────────────────────────────────
// This entry pulls drizzle and dataset definitions. It must never be imported
// from client code, from @platform/ui-kit, or from the package's own `.` entry.
//
// Import it only inside a Fastify service's report repository, and only inside
// withRoleTx — see the caller contract at the top of execute.ts.

export {
  findDimension,
  findMeasure,
  isFilterable,
  isGroupable,
  type DatasetCaps,
  type DatasetDef,
  type DimensionDef,
  type MeasureDef,
  type ScopeColumns,
} from './dataset.js';

export {
  assertDatasetPermitted,
  assertDatasetValid,
  createDatasetRegistry,
  toDatasetMeta,
  type DatasetRegistry,
} from './registry.js';

export { buildReportQuery, type BuiltReportQuery } from './build.js';

export { runReportQuery, type SqlExecutor } from './execute.js';

export {
  capabilityScope,
  tenancyPredicate,
  type ReportQueryContext,
  type ResolvedScope,
} from './scope.js';

export {
  ReportError,
  invalidSpec,
  mapReportDbError,
  type ReportErrorKind,
} from './errors.js';

// Exported for dataset authors who need to declare a custom aggregate-adjacent
// expression, and for the test suite. NOT for building queries by hand.
export { AGG, NUMERIC_AGGS, SUMMABLE_AGGS } from './aggregate.js';
export { BUCKET, DEFAULT_TIMEZONE } from './buckets.js';
export { FILTER_BUILDERS, assertFilterCompatible, escapeLikePattern } from './filters.js';
