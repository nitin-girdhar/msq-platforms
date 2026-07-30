// ── Running a report ─────────────────────────────────────────────────────────
// Takes an executor (a drizzle transaction, injected — this package never opens
// a connection and never imports @platform/db), runs the compiled query, and
// shapes the long rows into a ReportResult.
//
// CALLER CONTRACT — the repository that calls this MUST wrap it in
//   withRoleTx({ role, org_id, tenant_id, user_id, readOnly: true }, (tx) => …)
// with the REAL actor's values. That is what sets the RLS GUCs and the role, and
// it is layer 1 of the four described in scope.ts. This package cannot verify it
// happened, which is exactly why layers 2 and 3 exist in the query text.

import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DatasetDef } from './dataset.js';
import { ReportError, mapReportDbError } from './errors.js';
import { buildReportQuery } from './build.js';
import type { ReportQueryContext } from './scope.js';
import { LIMITS } from '../spec/limits.js';
import { applyTopN, countCells, grandTotals, pivotRows, type LongRow } from '../spec/pivot.js';
import type { ReportCell, ReportResult } from '../spec/result.js';

/** The narrow slice of a drizzle transaction this package needs. Injected so
 *  @platform/reporting never depends on @platform/db, and so `postgres` can
 *  never be pulled into a Next bundle through the browser-safe entry. */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

export async function runReportQuery(
  executor: SqlExecutor,
  def: DatasetDef,
  requestedSpec: Parameters<typeof buildReportQuery>[1],
  ctx: ReportQueryContext,
): Promise<ReportResult> {
  const built = buildReportQuery(def, requestedSpec, ctx);
  const startedAt = Date.now();

  const timeoutMs = def.caps?.timeoutMs ?? LIMITS.timeoutMs;

  let raw: unknown;
  try {
    // set_config() rather than `SET LOCAL`, because SET does not accept a bound
    // parameter — `SET LOCAL statement_timeout = $1` is a syntax error, whereas
    // set_config is an ordinary function whose arguments parameterize normally.
    // That keeps the timeout out of the query text without reaching for sql.raw.
    await executor.execute(sql`SELECT set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`);
    // Defence in depth against a caller who forgot `readOnly: true`. withRoleTx
    // normally sets this; if it did, this is a no-op. If it did not, the
    // database now physically rejects a write for the rest of the transaction.
    await executor.execute(sql`SELECT set_config('transaction_read_only', 'on', true)`);

    raw = await executor.execute(built.query);
  } catch (err) {
    // Maps statement_timeout to a 400 with actionable advice; rethrows anything
    // genuinely unexpected untouched.
    mapReportDbError(err);
  }

  const longRows = normalizeRows(raw);
  const truncated = longRows.length > built.limit;
  // The query fetched limit + 1 precisely so truncation is detectable without a
  // second COUNT. Drop the sentinel before pivoting.
  const kept = truncated ? longRows.slice(0, built.limit) : longRows;

  // The real cell check, BEFORE pivoting. The zod pre-flight could only see
  // rows × measures; only here is the series count known. Counting first matters
  // because sparse data makes the wide grid far larger than the input — see
  // countCells — and pivoting to find out would already have paid the cost.
  const cells = countCells(built.spec, kept);
  if (cells > LIMITS.maxCells) {
    throw new ReportError(
      'too_large',
      `This report produced ${cells.toLocaleString()} data points, over the ${LIMITS.maxCells.toLocaleString()} limit. Add a filter, use a coarser date bucket, or limit the breakdown to the top few values.`,
    );
  }

  let pivot = pivotRows(built.spec, kept);

  // topN is a presentation fold applied after aggregation, so "Other" is a real
  // total rather than a discarded tail.
  const topNDim = built.spec.rows[0];
  if (topNDim?.topN !== undefined) {
    const rankBy = topNDim.topNMeasure ?? built.spec.measures[0]?.id;
    if (rankBy !== undefined) pivot = applyTopN(built.spec, pivot, topNDim.topN, rankBy);
  }

  const totals = grandTotals(built.spec, pivot);

  return {
    spec: built.spec,
    columns: pivot.columns,
    rows: pivot.rows,
    series: pivot.series,
    ...(totals !== undefined && { grandTotals: totals }),
    meta: {
      rowCount: pivot.rows.length,
      truncated,
      elapsedMs: Date.now() - startedAt,
      appliedScope: built.appliedScope,
      generatedAt: new Date().toISOString(),
      timezone: built.timezone,
    },
  };
}

/**
 * Normalize whatever the driver returned into an array of rows.
 *
 * postgres.js hands back an array-like directly; node-postgres wraps it in
 * `{ rows }`. Both shapes appear across this codebase's drizzle setups, so both
 * are accepted rather than assuming one driver.
 */
function normalizeRows(raw: unknown): LongRow[] {
  const rows: unknown = Array.isArray(raw)
    ? raw
    : ((raw as { rows?: unknown } | null)?.rows ?? []);
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => coerceRow(r as Record<string, unknown>));
}

/** Measure output aliases, per the convention build.ts establishes. */
const MEASURE_ALIAS = /^m\d+$/;

/**
 * Coerce driver output into ReportCells.
 *
 * The aggregate casts in aggregate.ts (::int, ::float8) already make the common
 * cases arrive as JS numbers. This is the safety net for the rest: postgres.js
 * returns NUMERIC as a string to preserve precision, and a chart handed "42"
 * silently renders a category axis instead of a value axis — a bug that looks
 * like a styling problem and is a typing problem.
 *
 * Numeric coercion is applied ONLY to measure columns. A dimension value can
 * legitimately be a numeric-looking string — a pincode, an order code, a
 * zero-padded id — and turning "007" into 7 would corrupt an axis label and
 * break grouping identity. Measures are the only columns guaranteed numeric, so
 * they are the only ones coerced.
 *
 * Dates become ISO strings: a Date object does not survive JSON, and the client
 * formats the bucket label itself.
 */
function coerceRow(row: Record<string, unknown>): LongRow {
  const out: Record<string, ReportCell> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = coerceCell(value, MEASURE_ALIAS.test(key));
  }
  return out;
}

function coerceCell(value: unknown, numeric: boolean): ReportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return numeric && isNumericString(value) ? Number(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  // A count that overflows a double is not a chartable number, but Number() is
  // still the least surprising thing to hand a chart — and MIN/MAX over a bigint
  // column is the realistic source here, not a genuinely huge count.
  if (typeof value === 'bigint') return Number(value);
  return String(value);
}

/** Deliberately strict: only a plain decimal, so a uuid or a date string is
 *  never mistaken for a number even in a measure column. */
function isNumericString(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value));
}
