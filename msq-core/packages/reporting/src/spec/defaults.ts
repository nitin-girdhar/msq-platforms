// ── Starting points and spec surgery ─────────────────────────────────────────
// Shared by the builder UI (so a new report opens on something that already
// renders) and by tests. Pure functions over a spec — no I/O.

import type { DatasetMeta, DimensionMeta } from './dataset-meta.js';
import { LIMITS } from './limits.js';
import type { AggFn, DateBucket, FilterClause, MeasureRef, ReportSpec } from './types.js';
import { isTemporalKind } from './types.js';

/** The reserved measure key every dataset should expose: COUNT(*). */
export const COUNT_ROWS_FIELD = '*';

/** The date-range filter a `requiresDateRange` dataset needs. Uses
 *  `last_n_days` rather than an absolute range so a saved report stays a
 *  rolling window instead of freezing on the day it was created. */
export function defaultDateFilter(meta: DatasetMeta): FilterClause | null {
  if (!meta.requiresDateRange || meta.dateField === undefined) return null;
  return {
    field: meta.dateField,
    op: 'last_n_days',
    values: [meta.defaultWindowDays ?? 90],
  };
}

/**
 * A minimal valid spec for a dataset: count of rows, broken down by the first
 * sensible dimension, as a bar chart.
 *
 * "Sensible" = groupable and not high-cardinality. If the dataset offers only
 * high-cardinality dimensions we fall back to a KPI tile rather than opening on
 * a chart that would immediately need truncating.
 */
export function specForDataset(meta: DatasetMeta): ReportSpec {
  const measure = defaultMeasure(meta);
  const dim = pickDefaultDimension(meta);
  const dateFilter = defaultDateFilter(meta);
  const filters = dateFilter === null ? [] : [dateFilter];

  if (dim === undefined) {
    return {
      version: 1,
      dataset: meta.key,
      rows: [],
      columns: [],
      measures: [measure],
      filters,
      chart: { type: 'kpi', encoding: { measures: [measure.id] } },
    };
  }

  const bucket = defaultBucket(dim);
  return {
    version: 1,
    dataset: meta.key,
    rows: [{ field: dim.key, ...(bucket !== undefined && { bucket }) }],
    columns: [],
    measures: [measure],
    filters,
    chart: {
      // A time dimension reads as a trend; a category reads as a comparison.
      type: isTemporalKind(dim.kind) ? 'line' : 'bar',
      encoding: { measures: [measure.id], showLegend: false },
    },
  };
}

/** An empty-but-valid spec, for the case where no dataset is chosen yet. Not
 *  submittable (the compiler will reject an unknown dataset) — it exists so the
 *  builder's controlled state is never null. */
export function emptySpec(datasetKey = ''): ReportSpec {
  return {
    version: 1,
    dataset: datasetKey,
    rows: [],
    columns: [],
    measures: [{ id: 'm1', field: COUNT_ROWS_FIELD, agg: 'count' }],
    filters: [],
    chart: { type: 'table', encoding: { measures: ['m1'] } },
  };
}

function defaultMeasure(meta: DatasetMeta): MeasureRef {
  const countRows = meta.measures.find((m) => m.key === COUNT_ROWS_FIELD);
  if (countRows !== undefined) {
    return { id: 'm1', field: COUNT_ROWS_FIELD, agg: 'count', label: countRows.label };
  }
  // A dataset with no COUNT(*) is unusual but legal; take the first measure and
  // its first permitted aggregation.
  const first = meta.measures[0];
  if (first === undefined) {
    throw new Error(`Dataset '${meta.key}' declares no measures`);
  }
  const agg: AggFn = first.aggs[0] ?? 'count';
  return { id: 'm1', field: first.key, agg, label: first.label };
}

function pickDefaultDimension(meta: DatasetMeta): DimensionMeta | undefined {
  const groupable = meta.dimensions.filter((d) => d.groupable);
  return groupable.find((d) => d.cardinality !== 'high') ?? groupable[0];
}

function defaultBucket(dim: DimensionMeta): DateBucket | undefined {
  if (!isTemporalKind(dim.kind)) return undefined;
  const buckets = dim.buckets ?? [];
  return buckets.includes('month') ? 'month' : buckets[0];
}

// ── Shelf capacity, for the UI's drop zones ──────────────────────────────────
// The builder must disable a drop target BEFORE the user places a field the
// server would reject, so these read from the same LIMITS and CHART_SHAPE_RULES
// the validator uses.

export type Shelf = 'rows' | 'columns' | 'measures';

export function shelfCapacity(shelf: Shelf): number {
  switch (shelf) {
    case 'rows':
      return LIMITS.maxRowDims;
    case 'columns':
      return LIMITS.maxColumnDims;
    case 'measures':
      return LIMITS.maxMeasures;
  }
}

export function canAcceptOnShelf(spec: ReportSpec, shelf: Shelf): boolean {
  return spec[shelf].length < shelfCapacity(shelf);
}

/** Next unused measure id (m1, m2, …). */
export function nextMeasureId(spec: ReportSpec): string {
  const used = new Set(spec.measures.map((m) => m.id));
  for (let i = 1; i <= LIMITS.maxMeasures + 1; i++) {
    const id = `m${i}`;
    if (!used.has(id)) return id;
  }
  // Unreachable while measures are capped, but a thrown error beats a duplicate
  // id silently colliding in a Record.
  throw new Error('No free measure id');
}
