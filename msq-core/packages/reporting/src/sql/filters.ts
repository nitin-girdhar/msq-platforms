// ── Filter predicates ────────────────────────────────────────────────────────
// One builder per FilterOp, in a closed Record. Every value is a BOUND
// PARAMETER — there is no path from `FilterClause.values` into SQL text.
//
// The casts are the subtle part. A bound parameter arrives as text, and
// Postgres will not always infer the right type from context (`expr = $1`
// against a uuid column errors rather than coercing). So each value is cast
// according to the DIMENSION'S declared kind — from the DatasetDef, never from
// the payload. That means a client cannot choose the cast, and a string sent for
// a uuid column fails as a type error inside a parameter, not as syntax.

import { sql, type SQL } from 'drizzle-orm';
import type { DateBucket, FieldKind, FilterOp, FilterValue } from '../spec/types.js';
import { FILTER_ARITY, isTemporalKind } from '../spec/types.js';
import { LIMITS } from '../spec/limits.js';
import { invalidSpec, requireKey } from './errors.js';

export interface FilterBuildContext {
  /** The dimension's source-authored expression. */
  expr: SQL;
  /** The dimension's declared kind — the sole source of the cast. */
  kind: FieldKind;
  values: readonly FilterValue[];
  /** Bound timezone parameter, for the relative-date ops. */
  tz: SQL;
  bucket?: DateBucket;
  /** For error messages, e.g. "filters[2]". */
  path: string;
}

/** Cast a bound value to the column's type. The cast comes from `kind`, which
 *  comes from the DatasetDef — this is why a payload cannot pick its own cast. */
function typed(value: FilterValue, kind: FieldKind): SQL {
  switch (kind) {
    case 'uuid':
      return sql`${value}::uuid`;
    case 'number':
      return sql`${value}::numeric`;
    case 'date':
      return sql`${value}::date`;
    case 'timestamp':
      return sql`${value}::timestamptz`;
    case 'boolean':
      return sql`${value}::boolean`;
    case 'string':
      return sql`${value}::text`;
  }
}

/** Reject NULL in a comparison. `col = NULL` is never true, so accepting it
 *  would silently return zero rows and look like "no data" rather than a
 *  mistake. `is_null` is the op that means this. */
function scalar(ctx: FilterBuildContext, index = 0): SQL {
  const value = ctx.values[index];
  if (value === undefined || value === null) {
    throw invalidSpec(
      `filter value ${index} must not be null — use the 'is_null' operator instead`,
      ctx.path,
    );
  }
  return typed(value, ctx.kind);
}

/**
 * Escape LIKE metacharacters in a user-supplied needle.
 *
 * Without this, a search for "50%" matches everything, and "_" matches any
 * character — surprising rather than dangerous, but a `\` in the needle would
 * additionally corrupt the pattern. The backslash must be escaped FIRST, or it
 * would then escape the escapes we just added.
 *
 * The resulting pattern is still bound as a parameter; only `ESCAPE '\'` is
 * source text.
 */
export function escapeLikePattern(needle: string): string {
  return needle.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function text(ctx: FilterBuildContext): string {
  const value = ctx.values[0];
  if (typeof value !== 'string') {
    throw invalidSpec(`filter operator requires a single string value`, ctx.path);
  }
  return value;
}

/** `now()` truncated to a bucket, as a NAIVE LOCAL timestamp in `tz`. */
function localTrunc(bucket: DateBucket, tz: SQL): SQL {
  switch (bucket) {
    case 'day':
      return sql`date_trunc('day', now() AT TIME ZONE ${tz})`;
    case 'week':
      return sql`date_trunc('week', now() AT TIME ZONE ${tz})`;
    case 'month':
      return sql`date_trunc('month', now() AT TIME ZONE ${tz})`;
    case 'quarter':
      return sql`date_trunc('quarter', now() AT TIME ZONE ${tz})`;
    case 'year':
      return sql`date_trunc('year', now() AT TIME ZONE ${tz})`;
  }
}

/**
 * Convert a naive local timestamp back into a comparable value for the column.
 *
 * A `timestamp`/`timestamptz` column compares against a timestamptz, so the
 * local wall time is converted back through the same zone. A `date` column
 * compares against a date, so the local timestamp is cast down. Getting this
 * wrong shifts every boundary by the UTC offset — the same class of bug the
 * bucketing comment in buckets.ts describes.
 */
function boundaryFor(kind: FieldKind, localTs: SQL, tz: SQL): SQL {
  return kind === 'date' ? sql`(${localTs})::date` : sql`((${localTs}) AT TIME ZONE ${tz})`;
}

export const FILTER_BUILDERS: Readonly<Record<FilterOp, (ctx: FilterBuildContext) => SQL>> = {
  eq: (ctx) => sql`${ctx.expr} = ${scalar(ctx)}`,
  ne: (ctx) => sql`${ctx.expr} <> ${scalar(ctx)}`,
  gt: (ctx) => sql`${ctx.expr} > ${scalar(ctx)}`,
  gte: (ctx) => sql`${ctx.expr} >= ${scalar(ctx)}`,
  lt: (ctx) => sql`${ctx.expr} < ${scalar(ctx)}`,
  lte: (ctx) => sql`${ctx.expr} <= ${scalar(ctx)}`,

  between: (ctx) => sql`${ctx.expr} BETWEEN ${scalar(ctx, 0)} AND ${scalar(ctx, 1)}`,

  in: (ctx) => {
    const list = ctx.values.map((_, i) => scalar(ctx, i));
    return sql`${ctx.expr} IN (${sql.join(list, sql`, `)})`;
  },
  // NOT IN is null-blind by design in SQL: if the column is NULL the row is
  // excluded. That is what a user means by "not one of these" often enough, and
  // spelling out the alternative would need a three-valued-logic UI.
  not_in: (ctx) => {
    const list = ctx.values.map((_, i) => scalar(ctx, i));
    return sql`${ctx.expr} NOT IN (${sql.join(list, sql`, `)})`;
  },

  is_null: (ctx) => sql`${ctx.expr} IS NULL`,
  is_not_null: (ctx) => sql`${ctx.expr} IS NOT NULL`,

  // ILIKE, not LIKE: a case-sensitive "contains" is never what a user means by
  // a search box. The pattern is bound; only ESCAPE is source text.
  contains: (ctx) => sql`${ctx.expr}::text ILIKE ${`%${escapeLikePattern(text(ctx))}%`} ESCAPE '\\'`,
  starts_with: (ctx) => sql`${ctx.expr}::text ILIKE ${`${escapeLikePattern(text(ctx))}%`} ESCAPE '\\'`,

  /** Rolling window aligned to LOCAL midnight, not to "now minus 24n hours" —
   *  a "last 7 days" report run at 09:00 and at 17:00 must cover the same days,
   *  or two people comparing numbers on the same morning disagree. */
  last_n_days: (ctx) => {
    const n = ctx.values[0];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      throw invalidSpec('last_n_days requires a positive integer', ctx.path);
    }
    const startLocal = sql`date_trunc('day', now() AT TIME ZONE ${ctx.tz}) - make_interval(days => ${n - 1}::int)`;
    return sql`${ctx.expr} >= ${boundaryFor(ctx.kind, startLocal, ctx.tz)}`;
  },

  /** Period-to-date: this month/quarter/year so far. */
  this_period: (ctx) => {
    if (ctx.bucket === undefined) {
      throw invalidSpec("filter 'this_period' requires a bucket", ctx.path);
    }
    const startLocal = localTrunc(ctx.bucket, ctx.tz);
    return sql`${ctx.expr} >= ${boundaryFor(ctx.kind, startLocal, ctx.tz)}`;
  },
} as const;

/**
 * Re-validate a clause against its dimension's kind and the op's arity.
 *
 * The zod schema already did the arity check. This runs again because zod
 * validated the spec in isolation, while only here do we know the dimension's
 * KIND — and because a spec read back out of report_definitions.spec JSONB has
 * a different provenance than a request body. Defence in depth is cheap; a
 * missed check is not.
 */
export function assertFilterCompatible(
  op: FilterOp,
  kind: FieldKind,
  values: readonly FilterValue[],
  path: string,
): void {
  // Checked, so an unknown op raises a ReportError('invalid_spec') rather than a
  // TypeError on `undefined.min`.
  const arity = requireKey(FILTER_ARITY, op, 'filter operator', path);
  if (values.length < arity.min) {
    throw invalidSpec(`filter '${op}' needs at least ${arity.min} value(s)`, path);
  }
  if (arity.max !== null && values.length > arity.max) {
    throw invalidSpec(`filter '${op}' takes at most ${arity.max} value(s)`, path);
  }
  if (values.length > LIMITS.maxFilterValues) {
    throw invalidSpec(`filter '${op}' exceeds ${LIMITS.maxFilterValues} values`, path);
  }
  if (arity.temporalOnly === true && !isTemporalKind(kind)) {
    throw invalidSpec(`filter '${op}' applies only to date fields, not '${kind}'`, path);
  }
  if (arity.textOnly === true && kind !== 'string') {
    throw invalidSpec(`filter '${op}' applies only to text fields, not '${kind}'`, path);
  }
}
