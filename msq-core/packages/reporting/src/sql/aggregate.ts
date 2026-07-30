// ── Aggregate functions ──────────────────────────────────────────────────────
// A closed Record keyed by AggFn. The compiler cannot emit an aggregate that is
// not a key here, and AggFn is a closed union from a frozen `as const`, so
// `AGG['DROP TABLE']` is a type error and a runtime miss.
//
// Casts are deliberate:
//   count / count_distinct → ::int, because postgres.js hands back bigint as a
//     STRING and a chart that receives "42" renders a category axis, not a
//     value axis.
//   sum / avg              → ::float8, same reason for numeric.
//   min / max              → uncast, because MIN over a timestamp column is a
//     legitimate measure and ::float8 would break it.
//
// KNOWN LIMIT: ::float8 on SUM loses exactness past 2^53. That is acceptable
// for aggregate reporting and NOT acceptable for anything reconciled against
// money. If a currency dataset ever needs exact totals, add a `sum_exact` that
// casts to ::text and parse it as a decimal client-side — do not silently widen
// this one.

import { sql, type SQL } from 'drizzle-orm';
import type { AggFn } from '../spec/types.js';

export const AGG: Readonly<Record<AggFn, (expr: SQL) => SQL>> = {
  // COUNT(*) ignores its argument by definition; the compiler passes the
  // reserved '*' measure's expr and it is discarded here.
  count: () => sql`COUNT(*)::int`,
  count_distinct: (expr) => sql`COUNT(DISTINCT ${expr})::int`,
  sum: (expr) => sql`SUM(${expr})::float8`,
  avg: (expr) => sql`AVG(${expr})::float8`,
  min: (expr) => sql`MIN(${expr})`,
  max: (expr) => sql`MAX(${expr})`,
} as const;

/** Aggregations whose per-group results can be summed across groups. Used for
 *  grand totals and topN "Other" folding. count_distinct is EXCLUDED: summing
 *  per-group distinct counts double-counts anything appearing in two groups. */
export const SUMMABLE_AGGS: readonly AggFn[] = ['count', 'sum'];

/** Aggregations that produce a number rather than passing a value through.
 *  min/max inherit the source column's type. */
export const NUMERIC_AGGS: readonly AggFn[] = ['count', 'count_distinct', 'sum', 'avg'];
