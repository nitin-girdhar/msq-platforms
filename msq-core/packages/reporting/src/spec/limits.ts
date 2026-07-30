// ── Hard caps on a report request ───────────────────────────────────────────
// These are the ONLY numbers that bound a report query. They live in the
// browser-safe entry (not under sql/) for two reasons: the zod schema enforces
// them at the edge, and the builder UI needs them to disable a drop zone before
// the user places a field the server would reject. A cap that the UI cannot see
// produces a 400 the user cannot explain.
//
// Every one of these is a denial-of-service boundary, not a style preference:
// the shapes they exclude are the ones that either blow up the SQL plan
// (maxRowDims × maxColumnDims), the response body (maxGroups, maxCells), or the
// parameter array (maxFilterValues).

export const LIMITS = {
  /** Pivot row shelf. 2 is the deepest nesting a chart x-axis can render legibly. */
  maxRowDims: 2,
  /** Pivot column shelf = the chart's series breakdown. One only: each distinct
   *  value becomes a series, and the cell count is rows × series × measures. */
  maxColumnDims: 1,
  maxMeasures: 4,
  maxFilters: 20,
  /** Per `in`/`not_in` clause. Bounds the bound-parameter array. */
  maxFilterValues: 200,

  /** Groups returned when the spec names no limit. */
  defaultGroups: 1000,
  /** Ceiling on spec.limit. We fetch maxGroups + 1 to detect truncation. */
  maxGroups: 5000,
  /** Pre-flight bound on rows × series × measures — checked BEFORE the query
   *  runs, from the spec alone where possible, and again after the group count
   *  is known. A chart dies long before Postgres does. */
  maxCells: 20_000,

  /** Per-query statement_timeout. A breach is a 400 ("narrow your filters"),
   *  never a 500 — see mapReportDbError. */
  timeoutMs: 10_000,

  /** Saved definitions per user, per product. */
  maxSavedPerUser: 200,

  // ── Free-text length caps. These fields never reach SQL (they are
  // presentation only), but they are persisted in a JSONB spec and rendered
  // into HTML email, so they are still untrusted input with a size.
  maxLabelLen: 120,
  maxDatasetKeyLen: 64,
  maxMeasureIdLen: 32,
  /** A single `contains`/`starts_with` needle. */
  maxFilterTextLen: 200,
} as const;

/** Clamp an optional client-supplied group limit into [1, maxGroups]. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return LIMITS.defaultGroups;
  return Math.min(Math.max(Math.trunc(limit), 1), LIMITS.maxGroups);
}
