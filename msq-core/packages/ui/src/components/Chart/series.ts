// ── Series resolution ────────────────────────────────────────────────────────
// The one place that turns a (spec, result) pair into "what do I draw, in what
// order, in what colour". ReportChart, ChartLegend, ChartTooltip and DataTable
// all read from here, so a legend swatch and its line can never disagree.
//
// NOT in the approved plan's file list — a deliberate addition. The alternative
// was to export it from ReportChart.tsx, which the legend and tooltip would
// then have to import, dragging Recharts into every module that wants a colour.
//
// Everything here consumes `ReportResult` EXACTLY as the server returns it:
// rows are already pivoted wide and keyed by cellKey(measureId, seriesKey);
// `result.series` is authoritative for render order (it is first-seen order
// from the SQL ORDER BY, not a re-sort).

import { cellKey, dimKey, measureLabel, type MeasureRef, type ReportResult } from '@platform/reporting';

import { type ChartMode, overrideFor, seriesColor } from './palette';

/** One drawn thing: a line, an area band, a bar stack segment, a pie ring, a
 *  scatter cloud, or a table value column. */
export interface DrawnSeries {
  /** Key into a wide row. Exactly `cellKey(measureId, seriesKey)`. */
  dataKey: string;
  /** What the legend and tooltip call it. */
  label: string;
  color: string;
  measureId: string;
  /** Absent when the spec has no column dimension. */
  seriesKey?: string;
  measure: MeasureRef;
}

function measureById(result: ReportResult, id: string): MeasureRef | undefined {
  return result.spec.measures.find((m) => m.id === id);
}

/**
 * Which measures the chart draws, in spec order.
 *
 * `encoding.measures` is a filter, not a reordering: a spec that lists them out
 * of order must not repaint the survivors (colour follows the entity, never its
 * rank). So slot assignment below always uses the position in `spec.measures`,
 * never the position in `encoding.measures`. An empty/unknown encoding list
 * falls back to every measure rather than drawing nothing.
 */
export function drawnMeasures(result: ReportResult): MeasureRef[] {
  const wanted = new Set(result.spec.chart.encoding.measures);
  const xMeasure = result.spec.chart.encoding.xMeasure;
  const selected = result.spec.measures.filter(
    (m) => (wanted.size === 0 || wanted.has(m.id)) && m.id !== xMeasure,
  );
  return selected.length > 0 ? selected : [...result.spec.measures];
}

/**
 * Every drawn series, in render order, with its fixed palette slot.
 *
 * Order is measure-major (m1/A, m1/B, m2/A, m2/B) to match the pivot's own
 * column order, so a stacked bar's segments and a table's value columns land in
 * the same sequence the server described.
 *
 * The slot index is computed from the FULL cross product of spec.measures ×
 * result.series — not from the filtered list — so hiding one measure in the
 * encoding does not recolour the others.
 */
export function resolveSeries(result: ReportResult, mode: ChartMode = 'light'): DrawnSeries[] {
  const { spec, series } = result;
  const overrides = spec.chart.encoding.colorOverrides;
  const visible = new Set(drawnMeasures(result).map((m) => m.id));
  const out: DrawnSeries[] = [];

  let slot = 0;
  for (const measure of spec.measures) {
    if (series.length === 0) {
      const isVisible = visible.has(measure.id);
      const index = slot;
      slot += 1;
      if (!isVisible) continue;
      out.push({
        dataKey: cellKey(measure.id),
        label: measureLabel(measure),
        color: seriesColor(index, overrideFor(overrides, measure.id, undefined), mode),
        measureId: measure.id,
        measure,
      });
      continue;
    }
    for (const s of series) {
      const isVisible = visible.has(measure.id);
      const index = slot;
      slot += 1;
      if (!isVisible) continue;
      out.push({
        dataKey: cellKey(measure.id, s.key),
        // With one measure the series label alone is unambiguous; with several,
        // the reader needs to know which measure a swatch belongs to.
        label: spec.measures.length === 1 ? s.label : `${measureLabel(measure)} — ${s.label}`,
        color: seriesColor(index, overrideFor(overrides, measure.id, s.key), mode),
        measureId: measure.id,
        seriesKey: s.key,
        measure,
      });
    }
  }
  return out;
}

/** The wide-row key holding the category / x-axis value. */
export function xAxisKey(result: ReportResult): string {
  const from = result.spec.chart.encoding.xFromRow ?? 0;
  const index = Number.isInteger(from) && from >= 0 && from < result.spec.rows.length ? from : 0;
  return dimKey(index);
}

/** Human label for the x axis, for an axis title or a tooltip header. */
export function xAxisLabel(result: ReportResult): string {
  const key = xAxisKey(result);
  return result.columns.find((c) => c.key === key)?.label ?? '';
}

/**
 * Scatter needs a second measure on the x axis. Resolved against
 * `spec.measures`, and `undefined` when the id names nothing — ReportChart
 * renders an explicit message in that case rather than a chart with an
 * invisible axis.
 */
export function scatterXSeries(result: ReportResult, mode: ChartMode = 'light'): DrawnSeries | undefined {
  const id = result.spec.chart.encoding.xMeasure;
  if (id === undefined) return undefined;
  const measure = measureById(result, id);
  if (measure === undefined) return undefined;
  const seriesKey = result.series[0]?.key;
  return {
    dataKey: cellKey(measure.id, seriesKey),
    label: measureLabel(measure),
    color: seriesColor(0, overrideFor(result.spec.chart.encoding.colorOverrides, measure.id, seriesKey), mode),
    measureId: measure.id,
    ...(seriesKey === undefined ? {} : { seriesKey }),
    measure,
  };
}

/** Legends are mandatory at ≥2 series and pointless at 1 (the title names it).
 *  `showLegend: false` in the encoding can suppress it, but nothing turns it ON
 *  for a single series. */
export function shouldShowLegend(result: ReportResult, drawn: readonly DrawnSeries[]): boolean {
  if (result.spec.chart.encoding.showLegend === false) return false;
  return drawn.length >= 2;
}
