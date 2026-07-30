// ── Long → wide ──────────────────────────────────────────────────────────────
// Postgres returns one row per (row-dims × column-dim) group in LONG form.
// Recharts and an HTML table both want WIDE form: one row per row-axis group,
// with a column per measure × series.
//
// This runs on the server (execute.ts, and the email renderer) and is exported
// for the client too, so a UI that already holds long rows can re-pivot without
// a round trip. That shared use is why it lives in the browser-safe entry and
// takes plain data — no drizzle, no DatasetDef.
//
// The long-row key convention is fixed by the compiler (../sql/build.ts):
//   d0, d1        row-dimension VALUES        (positional, matches spec.rows)
//   d0_label, …   optional display labels     (from DimensionDef.labelExpr)
//   c0, c0_label  the column-dimension value and label
//   m0, m1, …     measure values              (positional, matches spec.measures)
// Positional aliases are the point: no client-supplied string is ever a SQL
// identifier. The mapping back to client-facing measure ids happens here.

import { OTHER_GROUP_LABEL, cellKey, dimKey, type ReportCell, type ReportResultColumn, type ReportSeries } from './result.js';
import type { MeasureRef, ReportSpec } from './types.js';

/** A row exactly as the driver returned it. Keys per the convention above. */
export type LongRow = Readonly<Record<string, ReportCell>>;

export type WideRow = Record<string, ReportCell>;

export interface PivotOutput {
  columns: ReportResultColumn[];
  rows: WideRow[];
  series: ReportSeries[];
}

export const LONG_KEYS = {
  dim: (i: number) => `d${i}`,
  dimLabel: (i: number) => `d${i}_label`,
  col: 'c0',
  colLabel: 'c0_label',
  measure: (i: number) => `m${i}`,
} as const;

/** Stable identity for a row-axis group. JSON of the dimension values, so two
 *  groups collide only if every dimension value matches — including nulls,
 *  which JSON distinguishes from the string "null". */
function rowIdentity(row: LongRow, rowDimCount: number): string {
  const parts: ReportCell[] = [];
  for (let i = 0; i < rowDimCount; i++) parts.push(row[LONG_KEYS.dim(i)] ?? null);
  return JSON.stringify(parts);
}

function displayLabel(value: ReportCell, label: ReportCell): string {
  if (typeof label === 'string' && label !== '') return label;
  if (value === null) return '—';
  return String(value);
}

/**
 * How many wide cells `pivotRows` WOULD produce, without producing them.
 *
 * Call this before pivoting. The danger is sparse data: long rows are a subset
 * of (row-groups × series), so the wide grid can be vastly larger than the input.
 * 5 000 long rows arranged diagonally — every row a distinct group AND a distinct
 * series — pivot to 5 000 × 5 000 = 25 million cells, because the fill pass in
 * pivotRows writes an explicit null into every hole.
 *
 * Checking the count after pivoting would report the problem accurately and only
 * after paying its whole memory cost, which for that shape means an OOM rather
 * than a 400. Two Sets are cheap; the grid is not.
 */
export function countCells(spec: ReportSpec, longRows: readonly LongRow[]): number {
  const groups = new Set<string>();
  const series = new Set<string>();
  for (const row of longRows) {
    groups.add(rowIdentity(row, spec.rows.length));
    if (spec.columns.length > 0) {
      const raw = row[LONG_KEYS.col] ?? null;
      series.add(raw === null ? '' : String(raw));
    }
  }
  return groups.size * Math.max(series.size, 1) * spec.measures.length;
}

export function pivotRows(spec: ReportSpec, longRows: readonly LongRow[]): PivotOutput {
  const rowDims = spec.rows;
  const hasSeries = spec.columns.length > 0;

  // ── series, in first-seen (i.e. SQL ORDER BY) order ──
  const seriesByKey = new Map<string, ReportSeries>();
  if (hasSeries) {
    for (const row of longRows) {
      const raw = row[LONG_KEYS.col] ?? null;
      const key = raw === null ? '' : String(raw);
      if (!seriesByKey.has(key)) {
        seriesByKey.set(key, { key, label: displayLabel(raw, row[LONG_KEYS.colLabel] ?? null) });
      }
    }
  }
  const series = [...seriesByKey.values()];

  // ── one wide row per row-axis group, first-seen order preserved ──
  const wideByIdentity = new Map<string, WideRow>();
  for (const row of longRows) {
    const identity = rowIdentity(row, rowDims.length);
    let wide = wideByIdentity.get(identity);
    if (wide === undefined) {
      wide = {};
      for (let i = 0; i < rowDims.length; i++) {
        const value = row[LONG_KEYS.dim(i)] ?? null;
        // The wide row carries the DISPLAY value: a chart axis and an HTML
        // table both render this directly, and the raw surrogate id is of no
        // use to either. Filters address dimensions by field key, not by the
        // value shown here, so nothing downstream needs the id back.
        wide[dimKey(i)] = displayLabel(value, row[LONG_KEYS.dimLabel(i)] ?? null);
      }
      wideByIdentity.set(identity, wide);
    }
    const seriesKey = hasSeries
      ? ((): string => {
          const raw = row[LONG_KEYS.col] ?? null;
          return raw === null ? '' : String(raw);
        })()
      : undefined;

    spec.measures.forEach((m, j) => {
      const value = row[LONG_KEYS.measure(j)] ?? null;
      wide[cellKey(m.id, seriesKey)] = value;
    });
  }

  const rows = [...wideByIdentity.values()];

  // ── columns, in render order: dimensions first, then measure × series ──
  const columns: ReportResultColumn[] = [];
  rowDims.forEach((d, i) => {
    columns.push({
      key: dimKey(i),
      label: d.label ?? d.field,
      role: 'dimension',
      // Post-pivot a dimension cell is always its rendered label.
      kind: 'string',
    });
  });
  if (hasSeries) {
    // Measure-major (m1/A, m1/B, m2/A, m2/B) so a stacked bar's series stay
    // adjacent and a table groups its value columns under one measure.
    for (const m of spec.measures) {
      for (const s of series) {
        columns.push({
          key: cellKey(m.id, s.key),
          label: spec.measures.length === 1 ? s.label : `${measureLabel(m)} — ${s.label}`,
          role: 'measure',
          kind: 'number',
          measureId: m.id,
          seriesKey: s.key,
        });
      }
    }
  } else {
    for (const m of spec.measures) {
      columns.push({
        key: cellKey(m.id),
        label: measureLabel(m),
        role: 'measure',
        kind: 'number',
        measureId: m.id,
      });
    }
  }

  // A group absent for one series leaves a hole; charts need an explicit null
  // rather than a missing key, or Recharts silently connects across the gap.
  for (const row of rows) {
    for (const col of columns) {
      if (!(col.key in row)) row[col.key] = null;
    }
  }

  return { columns, rows, series };
}

export function measureLabel(m: MeasureRef): string {
  if (m.label !== undefined) return m.label;
  const field = m.field === '*' ? 'rows' : m.field;
  switch (m.agg) {
    case 'count':
      return 'Count';
    case 'count_distinct':
      return `Distinct ${field}`;
    case 'sum':
      return `Sum of ${field}`;
    case 'avg':
      return `Average ${field}`;
    case 'min':
      return `Min ${field}`;
    case 'max':
      return `Max ${field}`;
  }
}

/**
 * Fold all but the top N row-axis groups into a single "Other" row.
 *
 * Applied AFTER aggregation, in JS, because it is a presentation concern: the
 * SQL still aggregates every group (that is what makes "Other" correct), and a
 * LIMIT would instead discard the tail. Only summable aggregations are folded —
 * an average of averages is wrong, so avg/min/max cells on the Other row are
 * null rather than misleading.
 */
export function applyTopN(
  spec: ReportSpec,
  pivot: PivotOutput,
  topN: number,
  rankByMeasureId: string,
): PivotOutput {
  if (pivot.rows.length <= topN) return pivot;

  const measureCols = pivot.columns.filter((c) => c.role === 'measure');
  const rankCols = measureCols.filter((c) => c.measureId === rankByMeasureId);

  const scored = pivot.rows.map((row) => ({
    row,
    score: rankCols.reduce((sum, c) => {
      const v = row[c.key];
      return sum + (typeof v === 'number' ? v : 0);
    }, 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  const kept = scored.slice(0, topN).map((s) => s.row);
  const folded = scored.slice(topN).map((s) => s.row);

  const summable = new Set(
    spec.measures.filter((m) => m.agg === 'count' || m.agg === 'count_distinct' || m.agg === 'sum').map((m) => m.id),
  );

  const other: WideRow = {};
  for (const col of pivot.columns) {
    if (col.role === 'dimension') {
      other[col.key] = col.key === dimKey(0) ? OTHER_GROUP_LABEL : '';
      continue;
    }
    if (col.measureId !== undefined && summable.has(col.measureId)) {
      other[col.key] = folded.reduce((sum, r) => {
        const v = r[col.key];
        return sum + (typeof v === 'number' ? v : 0);
      }, 0);
    } else {
      // count_distinct is summed here as an approximation of convenience — see
      // the caveat below. avg/min/max are simply not foldable.
      other[col.key] = null;
    }
  }

  return { ...pivot, rows: [...kept, other] };
}

/**
 * Grand totals per measure cell, or undefined when no measure is summable.
 *
 * NOTE on count_distinct: summing per-group distinct counts DOUBLE COUNTS any
 * value appearing in two groups, so it is excluded here. A correct
 * cross-group distinct count needs its own query, which is deliberately out of
 * scope — a wrong total is worse than an absent one.
 */
export function grandTotals(
  spec: ReportSpec,
  pivot: PivotOutput,
): Record<string, number | null> | undefined {
  const summable = new Set(spec.measures.filter((m) => m.agg === 'count' || m.agg === 'sum').map((m) => m.id));
  if (summable.size === 0) return undefined;

  const totals: Record<string, number | null> = {};
  for (const col of pivot.columns) {
    if (col.role !== 'measure' || col.measureId === undefined) continue;
    if (!summable.has(col.measureId)) {
      totals[col.key] = null;
      continue;
    }
    totals[col.key] = pivot.rows.reduce((sum, r) => {
      const v = r[col.key];
      return sum + (typeof v === 'number' ? v : 0);
    }, 0);
  }
  return totals;
}
