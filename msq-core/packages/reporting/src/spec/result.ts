// ── The report result envelope ───────────────────────────────────────────────
// Browser-safe. What the /query endpoint returns, and the sole input to both
// ReportChart and the scheduled-email renderer.
//
// Rows here are ALREADY PIVOTED (wide form): one object per row-axis group,
// with a key per measure × series cell. The long form that Postgres returns is
// an internal detail of ../sql/execute.ts and pivot.ts — nothing downstream
// sees it, because Recharts and an HTML table both want wide rows.

import type { FieldKind, ReportSpec } from './types.js';

/** Separator between a measure id and a series key in a pivoted cell key.
 *  '::' is safe because measure ids are slug-constrained (no colons) by the zod
 *  schema, so a cell key always splits unambiguously on the FIRST occurrence. */
export const CELL_KEY_SEP = '::';

/** Build the wide-form key for a measure cell. No series key ⇒ the measure id
 *  alone (the no-column-dimension case). */
export function cellKey(measureId: string, seriesKey?: string): string {
  return seriesKey === undefined ? measureId : `${measureId}${CELL_KEY_SEP}${seriesKey}`;
}

/** Inverse of cellKey. Splits on the first separator only. */
export function parseCellKey(key: string): { measureId: string; seriesKey?: string } {
  const at = key.indexOf(CELL_KEY_SEP);
  if (at === -1) return { measureId: key };
  return {
    measureId: key.slice(0, at),
    seriesKey: key.slice(at + CELL_KEY_SEP.length),
  };
}

/** Stable key for a row-axis dimension column: dim_0, dim_1. Positional
 *  because two dimensions could legitimately share a field key across specs,
 *  and because the chart reads them by axis position. */
export function dimKey(index: number): string {
  return `dim_${index}`;
}

export type ReportCell = string | number | boolean | null;

export interface ReportResultColumn {
  /** dimKey(i) for a row dimension, or cellKey(measureId, seriesKey?) for a
   *  value. Matches the keys in `rows`. */
  key: string;
  label: string;
  role: 'dimension' | 'measure';
  kind: FieldKind;
  /** Set when role === 'measure'. */
  measureId?: string;
  /** The column-axis value this cell belongs to. Absent when the spec has no
   *  column dimension. */
  seriesKey?: string;
}

/** A distinct column-axis value, in render order. One series per entry. */
export interface ReportSeries {
  key: string;
  label: string;
}

export interface ReportResultMeta {
  /** Row-axis groups returned (after topN folding). */
  rowCount: number;
  /** True when the query hit LIMITS.maxGroups and rows were dropped. Surfaced
   *  in the UI and in email — a truncated chart that claims to be complete is
   *  worse than no chart. */
  truncated: boolean;
  elapsedMs: number;
  /** The capability scope actually applied to the rows. Echoed so a user can
   *  explain why their number differs from a colleague's. */
  appliedScope: 'own' | 'team' | 'org' | 'tenant' | 'all';
  /** ISO-8601. */
  generatedAt: string;
  /** The IANA zone the date buckets were computed in — the resolved value, not
   *  the requested one. */
  timezone: string;
}

export interface ReportResult {
  /** The spec as EXECUTED, after server-side clamping and defaulting. Not the
   *  spec as submitted: the client needs to know that its limit was clamped or
   *  its date range defaulted. */
  spec: ReportSpec;
  columns: readonly ReportResultColumn[];
  rows: readonly Readonly<Record<string, ReportCell>>[];
  /** Empty when the spec has no column dimension. */
  series: readonly ReportSeries[];
  /** Per measure-cell grand totals, keyed like `rows`. Absent for aggregations
   *  where a total is meaningless (avg/min/max are not summable across groups,
   *  so only count/count_distinct/sum contribute). */
  grandTotals?: Readonly<Record<string, number | null>>;
  meta: ReportResultMeta;
}

/** The label folded-away groups get when a dimension declares topN. */
export const OTHER_GROUP_LABEL = 'Other';
