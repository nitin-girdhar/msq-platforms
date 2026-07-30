// Hand-built ReportResults in exactly the shape /query returns: rows already
// pivoted wide, keyed by cellKey(measureId, seriesKey), `series` in render
// order. Nothing here calls the pivot — the point is to pin what the chart
// layer consumes, independently of how the server produced it.

import { cellKey, dimKey, type ReportResult, type ReportSpec } from '@platform/reporting';

export function spec(overrides: Partial<ReportSpec> = {}): ReportSpec {
  return {
    version: 1,
    dataset: 'fixture',
    rows: [{ field: 'bucket' }],
    columns: [],
    measures: [{ id: 'm_a', field: '*', agg: 'count' }],
    filters: [],
    chart: { type: 'line', encoding: { measures: ['m_a'] } },
    ...overrides,
  };
}

export function result(overrides: Partial<ReportResult> = {}): ReportResult {
  const s = overrides.spec ?? spec();
  return {
    spec: s,
    columns: [
      { key: dimKey(0), label: 'Bucket', role: 'dimension', kind: 'string' },
      { key: cellKey('m_a'), label: 'Count', role: 'measure', kind: 'number', measureId: 'm_a' },
    ],
    rows: [
      { [dimKey(0)]: 'Jan', [cellKey('m_a')]: 10 },
      // The hole. Every assertion about gaps hangs off this row.
      { [dimKey(0)]: 'Feb', [cellKey('m_a')]: null },
      { [dimKey(0)]: 'Mar', [cellKey('m_a')]: 30 },
    ],
    series: [],
    meta: {
      rowCount: 3,
      truncated: false,
      elapsedMs: 42,
      appliedScope: 'org',
      generatedAt: '2026-07-30T00:00:00.000Z',
      timezone: 'Asia/Kolkata',
    },
    ...overrides,
  };
}

/** Two measures × two series — the shape that exercises slot assignment. */
export function seriesResult(): ReportResult {
  const s = spec({
    columns: [{ field: 'stage' }],
    measures: [
      { id: 'm_a', field: '*', agg: 'count' },
      { id: 'm_b', field: 'value', agg: 'sum' },
    ],
    chart: { type: 'bar_stacked', encoding: { measures: ['m_a', 'm_b'] } },
  });
  return result({
    spec: s,
    series: [
      { key: 'new', label: 'New' },
      { key: 'won', label: 'Won' },
    ],
    columns: [
      { key: dimKey(0), label: 'Bucket', role: 'dimension', kind: 'string' },
      { key: cellKey('m_a', 'new'), label: 'Count — New', role: 'measure', kind: 'number', measureId: 'm_a', seriesKey: 'new' },
      { key: cellKey('m_a', 'won'), label: 'Count — Won', role: 'measure', kind: 'number', measureId: 'm_a', seriesKey: 'won' },
      { key: cellKey('m_b', 'new'), label: 'Sum — New', role: 'measure', kind: 'number', measureId: 'm_b', seriesKey: 'new' },
      { key: cellKey('m_b', 'won'), label: 'Sum — Won', role: 'measure', kind: 'number', measureId: 'm_b', seriesKey: 'won' },
    ],
    rows: [
      {
        [dimKey(0)]: 'Jan',
        [cellKey('m_a', 'new')]: 5,
        [cellKey('m_a', 'won')]: 2,
        [cellKey('m_b', 'new')]: 500,
        [cellKey('m_b', 'won')]: null,
      },
    ],
  });
}
