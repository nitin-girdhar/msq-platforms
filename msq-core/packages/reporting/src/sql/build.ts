// ── The compiler ─────────────────────────────────────────────────────────────
// ReportSpec + DatasetDef → a parameterized SQL query.
//
// THE ONE INVARIANT: every identifier, operator and keyword in the output comes
// from a `SQL` fragment authored in source — either in this file, in one of the
// closed Record maps (AGG, BUCKET, FILTER_BUILDERS, SORT_DIR), or in a
// DatasetDef. Every value from the request is a bound parameter. There is no
// third category, and `sql.raw` is not used anywhere in src/sql (there is a test
// asserting that).
//
// Two consequences worth stating, because they look like limitations and are
// actually the design:
//
//  * Output columns are aliased POSITIONALLY — d0, d0_label, c0, m0, m1. The
//    client's `measures[].id` never becomes a SQL alias; the mapping from
//    position back to id happens in JS (see spec/pivot.ts). So a measure id, the
//    one client-supplied string that ends up in a Record key, cannot reach the
//    query text at all.
//
//  * GROUP BY and ORDER BY reference the SELECT list BY ORDINAL rather than
//    re-emitting the expression. That is not a style choice — re-emitting a
//    bucketed date silently breaks every time-series report, because the
//    timezone parameter gets a new placeholder number each time and Postgres
//    then cannot match GROUP BY to SELECT. See the comment on ORDINAL below;
//    this was found by a real database after the unit tests all passed.

import { sql, type SQL } from 'drizzle-orm';
import { can } from '@platform/rbac';
import type { ScopeName } from '@platform/rbac';
import { AGG } from './aggregate.js';
import { BUCKET, DEFAULT_TIMEZONE } from './buckets.js';
import type { DatasetDef, DimensionDef, MeasureDef } from './dataset.js';
import { findDimension, findMeasure, isFilterable, isGroupable } from './dataset.js';
import { ReportError, invalidSpec, requireKey } from './errors.js';
import { FILTER_BUILDERS, assertFilterCompatible } from './filters.js';
import { assertDatasetPermitted } from './registry.js';
import { capabilityScope, tenancyPredicate, type ReportQueryContext } from './scope.js';
import { LIMITS, clampLimit } from '../spec/limits.js';
import { isValidTimeZone } from '../spec/schema.js';
import { LONG_KEYS } from '../spec/pivot.js';
import type { DimensionRef, MeasureRef, ReportSpec, SortDir } from '../spec/types.js';
import { isTemporalKind } from '../spec/types.js';

/** Ops that bound a temporal field from below — i.e. that satisfy a dataset's
 *  `requiresDateRange`. `lt`/`lte` alone bound only the future, which does
 *  nothing for the scan. */
const RANGE_SATISFYING_OPS: readonly string[] = ['gt', 'gte', 'between', 'last_n_days', 'this_period'];

/** NULLS LAST on both directions so an unset dimension value never leads a
 *  chart's category axis. Source-authored, keyed by a closed union. */
const SORT_DIR: Readonly<Record<SortDir, SQL>> = {
  asc: sql`ASC NULLS LAST`,
  desc: sql`DESC NULLS LAST`,
} as const;

/** SortDir is a closed union at compile time, but a spec out of JSONB can carry
 *  anything. An unchecked SORT_DIR[dir] yields undefined, which drizzle
 *  interpolates instead of rejecting — so the lookup is checked. */
function sortDir(dir: SortDir, path?: string): SQL {
  return requireKey(SORT_DIR, dir, 'sort direction', path);
}

/**
 * Output-position fragments for GROUP BY / ORDER BY.
 *
 * WHY ORDINALS AND NOT THE EXPRESSION AGAIN — this is load-bearing, do not
 * "simplify" it back:
 *
 * A bucketed date expression carries a BOUND PARAMETER (the timezone). Drizzle
 * emits a fresh placeholder every time a value is interpolated, so re-emitting
 * the same logical expression in GROUP BY produces
 *   SELECT   date_trunc('month', created_at AT TIME ZONE $1) AS d0
 *   GROUP BY date_trunc('month', created_at AT TIME ZONE $6)
 * and Postgres compares GROUP BY to SELECT *syntactically*: $1 and $6 are
 * different expressions, so it rejects the query with
 *   column "created_at" must appear in the GROUP BY clause
 * That fails EVERY time-series report — the most important thing this engine
 * does — and no amount of asserting on generated SQL text catches it, because
 * the text looks right. Only a real database does.
 *
 * An ordinal refers to the SELECT list by position, so the parameter-carrying
 * expression is emitted exactly once. Literal digits, authored here, keyed by a
 * bounds-checked index — no `sql.raw`, nothing client-derived.
 *
 * Capacity: 2 row dims × (key + label) + 1 col dim × (key + label) + 4 measures
 * = 10 output columns at the caps in LIMITS. 16 leaves headroom.
 */
const ORDINAL: readonly SQL[] = [
  sql`1`, sql`2`, sql`3`, sql`4`, sql`5`, sql`6`, sql`7`, sql`8`,
  sql`9`, sql`10`, sql`11`, sql`12`, sql`13`, sql`14`, sql`15`, sql`16`,
];

function ordinal(position: number): SQL {
  const frag = ORDINAL[position - 1];
  if (frag === undefined) {
    // Unreachable at the current caps; a thrown error beats emitting `undefined`.
    throw invalidSpec(`Output position ${position} exceeds the supported column count.`);
  }
  return frag;
}

/** Aliases are source text. A closed set, positional, never client-derived. */
const ALIAS = {
  dim: [sql`d0`, sql`d1`] as const,
  dimLabel: [sql`d0_label`, sql`d1_label`] as const,
  col: sql`c0`,
  colLabel: sql`c0_label`,
  measure: [sql`m0`, sql`m1`, sql`m2`, sql`m3`] as const,
} as const;

interface ResolvedDimension {
  ref: DimensionRef;
  def: DimensionDef;
  /** The grouping expression: bucketed when a bucket applies, else raw. */
  keyExpr: SQL;
  labelExpr?: SQL;
  /** What ORDER BY uses for this dimension. */
  sortExpr: SQL;
}

interface ResolvedMeasure {
  ref: MeasureRef;
  def: MeasureDef;
  /** The aggregate, e.g. COUNT(*)::int. */
  aggExpr: SQL;
}

export interface BuiltReportQuery {
  query: SQL;
  /** The spec AS EXECUTED — limit clamped, timezone resolved. The client is
   *  told what actually ran, not what it asked for. */
  spec: ReportSpec;
  appliedScope: ScopeName;
  timezone: string;
  /** Groups the caller asked for (clamped). The query fetches this + 1 so
   *  execute() can detect truncation without a second count query. */
  limit: number;
}

export function buildReportQuery(
  def: DatasetDef,
  spec: ReportSpec,
  ctx: ReportQueryContext,
): BuiltReportQuery {
  if (spec.dataset !== def.key) {
    // Guards against a caller resolving one dataset and passing another.
    throw invalidSpec(`Spec targets dataset '${spec.dataset}' but '${def.key}' was resolved.`);
  }
  assertDatasetPermitted(def, ctx.actor);

  const timezone = resolveTimezone(spec, ctx);
  const tz = sql`${timezone}`;

  const rows = spec.rows.map((r, i) => resolveDimension(def, r, ctx, tz, `rows[${i}]`));
  const columns = spec.columns.map((c, i) => resolveDimension(def, c, ctx, tz, `columns[${i}]`));
  const measures = spec.measures.map((m, i) => resolveMeasure(def, m, ctx, `measures[${i}]`));

  const scope = capabilityScope(def, ctx);
  const where = buildWhere(def, spec, ctx, tz, scope.predicate);
  // The select plan carries each output column's position; GROUP BY and ORDER BY
  // reference those positions rather than re-emitting the expression.
  const plan = buildSelect(rows, columns, measures);
  const select = plan.fragment;
  const groupBy = buildGroupBy(rows, columns, plan);
  const orderBy = buildOrderBy(spec, rows, columns, measures, plan);

  const limit = clampLimit(spec.limit ?? def.caps?.maxGroups);
  const executedSpec: ReportSpec = { ...spec, limit, timezone };

  // GROUP BY is omitted entirely for a KPI-style spec (no dimensions): the
  // aggregate over the whole filtered set is one row, and `GROUP BY ()` is not
  // portable SQL.
  const query =
    groupBy === null
      ? sql`SELECT ${select} FROM ${def.from} WHERE ${where}`
      : sql`SELECT ${select} FROM ${def.from} WHERE ${where} GROUP BY ${groupBy}${orderBy} LIMIT ${limit + 1}`;

  return { query, spec: executedSpec, appliedScope: scope.name, timezone, limit };
}

function resolveTimezone(spec: ReportSpec, ctx: ReportQueryContext): string {
  const candidate = spec.timezone ?? ctx.orgTimezone ?? DEFAULT_TIMEZONE;
  // Re-validated here even though the zod schema checked spec.timezone: this
  // value may also have come from ctx.orgTimezone, i.e. straight out of
  // entity.organizations, which zod never saw.
  if (!isValidTimeZone(candidate)) {
    throw invalidSpec(`'${candidate}' is not a valid IANA time zone.`);
  }
  return candidate;
}

// ── Dimensions ───────────────────────────────────────────────────────────────

function resolveDimension(
  def: DatasetDef,
  ref: DimensionRef,
  ctx: ReportQueryContext,
  tz: SQL,
  path: string,
): ResolvedDimension {
  const dim = findDimension(def, ref.field);
  if (dim === undefined) {
    throw invalidSpec(`Unknown field '${ref.field}' on dataset '${def.key}'.`, path);
  }
  if (!isGroupable(dim)) {
    throw invalidSpec(`Field '${dim.label}' cannot be grouped — it is filter-only.`, path);
  }
  if (dim.requiresCapability !== undefined && !can(ctx.actor, dim.requiresCapability)) {
    throw new ReportError('forbidden', `You do not have access to the '${dim.label}' field.`, path);
  }

  const temporal = isTemporalKind(dim.kind);
  let keyExpr = dim.expr;

  if (ref.bucket !== undefined) {
    if (!temporal) {
      throw invalidSpec(
        `Field '${dim.label}' is not a date field, so it cannot be bucketed by ${ref.bucket}.`,
        path,
      );
    }
    const allowed = dim.buckets ?? [];
    if (!allowed.includes(ref.bucket)) {
      throw invalidSpec(
        `Field '${dim.label}' does not support the '${ref.bucket}' bucket (allowed: ${allowed.join(', ') || 'none'}).`,
        path,
      );
    }
    keyExpr = BUCKET[ref.bucket](dim.expr, tz);
  } else if (temporal) {
    // Grouping a raw timestamp yields one group per row. The registry's startup
    // validation already forbids a groupable temporal dimension with no buckets,
    // so this is the "buckets exist but the spec omitted one" case.
    throw invalidSpec(
      `Field '${dim.label}' is a date field and needs a bucket (day, week, month, quarter or year).`,
      path,
    );
  }

  return {
    ref,
    def: dim,
    keyExpr,
    ...(dim.labelExpr !== undefined && { labelExpr: dim.labelExpr }),
    // A bucketed dimension sorts by its BUCKET, never by the underlying column:
    // ordering months by raw created_at would interleave them. For everything
    // else a declared sortExpr (a lookup's sort_order) beats the value itself,
    // which is how stages come out in pipeline order rather than alphabetically.
    sortExpr: ref.bucket !== undefined ? keyExpr : (dim.sortExpr ?? keyExpr),
  };
}

function resolveMeasure(
  def: DatasetDef,
  ref: MeasureRef,
  ctx: ReportQueryContext,
  path: string,
): ResolvedMeasure {
  const measure = findMeasure(def, ref.field);
  if (measure === undefined) {
    throw invalidSpec(`Unknown value field '${ref.field}' on dataset '${def.key}'.`, path);
  }
  if (measure.requiresCapability !== undefined && !can(ctx.actor, measure.requiresCapability)) {
    throw new ReportError('forbidden', `You do not have access to the '${measure.label}' value.`, path);
  }
  // Two gates on the aggregation: it must be a member of AggFn (enforced by the
  // type and by zod), AND this field must permit it. The second is what stops
  // SUM over a status id.
  if (!measure.aggs.includes(ref.agg)) {
    throw invalidSpec(
      `'${ref.agg}' is not available for '${measure.label}' (allowed: ${measure.aggs.join(', ')}).`,
      path,
    );
  }
  if (ref.field === '*' && ref.agg !== 'count') {
    throw invalidSpec(`The row-count value supports only 'count', not '${ref.agg}'.`, path);
  }
  return { ref, def: measure, aggExpr: AGG[ref.agg](measure.expr) };
}

// ── Clauses ──────────────────────────────────────────────────────────────────

/**
 * The SELECT list, plus where each thing landed.
 *
 * The positions are the whole point: GROUP BY and ORDER BY reference them as
 * ordinals so a parameter-carrying expression is emitted exactly once. See the
 * comment on ORDINAL.
 */
interface SelectPlan {
  fragment: SQL;
  /** Output position of each row dimension's KEY, by index into rows. */
  dimKeyPos: number[];
  /** Output position of each row dimension's label, where it has one. */
  dimLabelPos: Array<number | undefined>;
  colKeyPos?: number;
  colLabelPos?: number;
  /** Output position of each measure, by index into measures. */
  measurePos: number[];
}

function buildSelect(
  rows: readonly ResolvedDimension[],
  columns: readonly ResolvedDimension[],
  measures: readonly ResolvedMeasure[],
): SelectPlan {
  const parts: SQL[] = [];
  const plan: SelectPlan = { fragment: sql``, dimKeyPos: [], dimLabelPos: [], measurePos: [] };

  /** Append and return the 1-based output position. */
  const emit = (fragment: SQL): number => {
    parts.push(fragment);
    return parts.length;
  };

  rows.forEach((d, i) => {
    const alias = ALIAS.dim[i];
    const labelAlias = ALIAS.dimLabel[i];
    // Bounded by LIMITS.maxRowDims and validated by zod, so the alias table is
    // always long enough — but an out-of-range index would silently produce
    // `AS undefined`, so it is checked rather than asserted.
    if (alias === undefined || labelAlias === undefined) {
      throw invalidSpec(`Too many row fields (max ${LIMITS.maxRowDims}).`);
    }
    plan.dimKeyPos[i] = emit(sql`${d.keyExpr} AS ${alias}`);
    plan.dimLabelPos[i] =
      d.labelExpr === undefined ? undefined : emit(sql`${d.labelExpr} AS ${labelAlias}`);
  });

  const col = columns[0];
  if (col !== undefined) {
    plan.colKeyPos = emit(sql`${col.keyExpr} AS ${ALIAS.col}`);
    if (col.labelExpr !== undefined) {
      plan.colLabelPos = emit(sql`${col.labelExpr} AS ${ALIAS.colLabel}`);
    }
  }

  measures.forEach((m, i) => {
    const alias = ALIAS.measure[i];
    if (alias === undefined) {
      throw invalidSpec(`Too many values (max ${LIMITS.maxMeasures}).`);
    }
    plan.measurePos[i] = emit(sql`${m.aggExpr} AS ${alias}`);
  });

  plan.fragment = sql.join(parts, sql`, `);
  return plan;
}

function buildWhere(
  def: DatasetDef,
  spec: ReportSpec,
  ctx: ReportQueryContext,
  tz: SQL,
  scopePredicate: SQL | null,
): SQL {
  const parts: SQL[] = [];

  // Layer 2. First, unconditional, never spec-derived.
  parts.push(tenancyPredicate(def, ctx));
  if (def.scope.basePredicate !== undefined) parts.push(def.scope.basePredicate);
  // Layer 3.
  if (scopePredicate !== null) parts.push(scopePredicate);

  assertDateRangeSatisfied(def, spec);

  spec.filters.forEach((f, i) => {
    const path = `filters[${i}]`;
    const dim = findDimension(def, f.field);
    if (dim === undefined) {
      throw invalidSpec(`Unknown filter field '${f.field}' on dataset '${def.key}'.`, path);
    }
    if (!isFilterable(dim)) {
      throw invalidSpec(`Field '${dim.label}' cannot be filtered.`, path);
    }
    if (dim.requiresCapability !== undefined && !can(ctx.actor, dim.requiresCapability)) {
      throw new ReportError('forbidden', `You do not have access to the '${dim.label}' field.`, path);
    }

    const values = f.values ?? [];
    assertFilterCompatible(f.op, dim.kind, values, path);

    // Checked lookup, same reason as sortDir: the op is a closed union to the
    // type system and arbitrary text at runtime.
    const buildFilter = requireKey(FILTER_BUILDERS, f.op, 'filter operator', path);
    parts.push(
      buildFilter({
        // A filter targets the RAW column, never a bucketed expression: "created
        // in the last 30 days" must not be widened to "in a month that overlaps
        // the last 30 days".
        expr: dim.expr,
        kind: dim.kind,
        values,
        tz,
        ...(f.bucket !== undefined && { bucket: f.bucket }),
        path,
      }),
    );
  });

  return sql.join(parts, sql` AND `);
}

/**
 * Enforce a dataset's `requiresDateRange`.
 *
 * This is the guard that keeps an unbounded GROUP BY off a growing fact
 * relation. Without it the first big org discovers the missing index via a
 * 10-second timeout, in production, on a Monday morning.
 */
function assertDateRangeSatisfied(def: DatasetDef, spec: ReportSpec): void {
  if (def.requiresDateRange !== true || def.dateField === undefined) return;
  const satisfied = spec.filters.some(
    (f) => f.field === def.dateField && RANGE_SATISFYING_OPS.includes(f.op),
  );
  if (!satisfied) {
    const dim = findDimension(def, def.dateField);
    throw invalidSpec(
      `This report needs a date range on '${dim?.label ?? def.dateField}' — add a "last N days", "this period" or from/to filter.`,
    );
  }
}

/** Null when the spec has no dimensions at all (a KPI over the whole set). */
function buildGroupBy(
  rows: readonly ResolvedDimension[],
  columns: readonly ResolvedDimension[],
  plan: SelectPlan,
): SQL | null {
  if (rows.length === 0 && columns.length === 0) return null;

  // Keys and labels are grouped BY ORDINAL. Labels must be grouped at all
  // because they are neither aggregated nor provably dependent on the key (the
  // FROM is a view, so Postgres sees no primary key to infer from).
  //
  // The trade-off, stated plainly: if a label ever varies WITHIN a key — two rows
  // with the same stage id but different stage_label — this splits them into two
  // groups. For the lookup-backed dimensions these views expose, the label is a
  // function of the id, so it does not happen. A dataset whose labelExpr is not a
  // function of its expr is a definition bug.
  const parts: SQL[] = [];

  rows.forEach((_, i) => {
    const keyPos = plan.dimKeyPos[i];
    if (keyPos !== undefined) parts.push(ordinal(keyPos));
    const labelPos = plan.dimLabelPos[i];
    if (labelPos !== undefined) parts.push(ordinal(labelPos));
  });
  if (plan.colKeyPos !== undefined) parts.push(ordinal(plan.colKeyPos));
  if (plan.colLabelPos !== undefined) parts.push(ordinal(plan.colLabelPos));

  // A dimension with its own sortExpr (a lookup's sort_order, so stages come out
  // in pipeline order rather than alphabetically) must also be grouped, and it is
  // NOT in the SELECT list, so it cannot be referenced by ordinal. Re-emitting it
  // is safe precisely because a sortExpr is a plain column reference with no
  // bound parameter — which is the property the ORDINAL comment explains we
  // cannot rely on for a bucketed date.
  for (const d of [...rows, ...columns]) {
    if (d.sortExpr !== d.keyExpr) parts.push(d.sortExpr);
  }

  return sql.join(parts, sql`, `);
}

/** Empty SQL when there is nothing to order by, so it can be concatenated
 *  unconditionally. */
function buildOrderBy(
  spec: ReportSpec,
  rows: readonly ResolvedDimension[],
  columns: readonly ResolvedDimension[],
  measures: readonly ResolvedMeasure[],
  plan: SelectPlan,
): SQL {
  const parts: SQL[] = [];
  const measurePosById = new Map(measures.map((m, i) => [m.ref.id, plan.measurePos[i]]));

  // A dimension sorts by its ORDINAL when its sort expression is the grouping key
  // itself (the common case, and the only safe one for a bucketed date — see the
  // ORDINAL comment). A declared sortExpr is a parameter-free column reference, so
  // re-emitting that one is fine.
  const dimSort = (d: ResolvedDimension, position: number | undefined, dir: SortDir): SQL => {
    if (d.sortExpr !== d.keyExpr) return sql`${d.sortExpr} ${sortDir(dir)}`;
    if (position === undefined) throw invalidSpec(`Cannot sort by '${d.ref.field}'.`);
    return sql`${ordinal(position)} ${sortDir(dir)}`;
  };

  const measureSort = (id: string, dir: SortDir, path?: string): SQL => {
    // The zod schema already checked referential integrity; this is the
    // defence-in-depth pass for a spec that came out of JSONB.
    const position = measurePosById.get(id);
    if (position === undefined) throw invalidSpec(`Unknown value '${id}' in sort.`, path);
    return sql`${ordinal(position)} ${sortDir(dir, path)}`;
  };

  const dimEntries = [
    ...rows.map((d, i) => ({ d, position: plan.dimKeyPos[i] })),
    ...columns.map((d) => ({ d, position: plan.colKeyPos })),
  ];
  const dimByField = new Map(dimEntries.map((e) => [e.d.ref.field, e]));

  if (spec.orderBy !== undefined && spec.orderBy.length > 0) {
    spec.orderBy.forEach((o, i) => {
      const path = `orderBy[${i}]`;
      if (o.kind === 'measure') {
        parts.push(measureSort(o.ref, o.dir, path));
      } else {
        const entry = dimByField.get(o.ref);
        if (entry === undefined) throw invalidSpec(`Unknown field '${o.ref}' in sort.`, path);
        parts.push(dimSort(entry.d, entry.position, o.dir));
      }
    });
  } else {
    // Per-dimension sort, then a stable default. A chart with no ORDER BY gets
    // whatever order the plan produced, which changes between runs and makes a
    // line chart zig-zag.
    rows.forEach((d, i) => {
      const s = d.ref.sort;
      if (s?.by === 'measure' && s.measureId !== undefined) {
        parts.push(measureSort(s.measureId, s.dir));
      } else {
        parts.push(dimSort(d, plan.dimKeyPos[i], s?.dir ?? 'asc'));
      }
    });
    // Series always sort deterministically, so colours stay stable between runs
    // of the same report.
    for (const c of columns) {
      parts.push(dimSort(c, plan.colKeyPos, c.ref.sort?.dir ?? 'asc'));
    }
  }

  if (parts.length === 0) return sql``;
  return sql` ORDER BY ${sql.join(parts, sql`, `)}`;
}

// Re-exported so execute.ts and tests share one definition of the long-row key
// convention the SELECT aliases above establish.
export { LONG_KEYS };
