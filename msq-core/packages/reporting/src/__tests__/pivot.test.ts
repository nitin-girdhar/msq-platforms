import { describe, expect, it } from 'vitest';
import { applyTopN, grandTotals, pivotRows, type LongRow } from '../spec/pivot.js';
import { cellKey, dimKey, parseCellKey } from '../spec/result.js';
import { specFor } from './fixtures.js';

describe('cellKey / parseCellKey', () => {
  it('round-trips without a series', () => {
    expect(parseCellKey(cellKey('m1'))).toEqual({ measureId: 'm1' });
  });

  it('round-trips with a series', () => {
    expect(parseCellKey(cellKey('m1', 'Web'))).toEqual({ measureId: 'm1', seriesKey: 'Web' });
  });

  it('splits on the FIRST separator so a series key containing :: survives', () => {
    // Measure ids are slug-constrained (no colons), so the first separator is
    // always the real one and the remainder belongs entirely to the series.
    expect(parseCellKey('m1::a::b')).toEqual({ measureId: 'm1', seriesKey: 'a::b' });
  });
});

describe('pivotRows — no column dimension', () => {
  const spec = specFor();

  it('emits one wide row per group, keyed by measure id', () => {
    const long: LongRow[] = [
      { d0: 'new', d0_label: 'New', m0: 10 },
      { d0: 'won', d0_label: 'Won', m0: 4 },
    ];
    const out = pivotRows(spec, long);

    expect(out.series).toEqual([]);
    expect(out.rows).toEqual([
      { [dimKey(0)]: 'New', m1: 10 },
      { [dimKey(0)]: 'Won', m1: 4 },
    ]);
    expect(out.columns.map((c) => c.key)).toEqual([dimKey(0), 'm1']);
  });

  it('prefers the label column over the raw value', () => {
    const out = pivotRows(spec, [{ d0: 'uuid-1', d0_label: 'New', m0: 1 }]);
    expect(out.rows[0]?.[dimKey(0)]).toBe('New');
  });

  it('renders a null dimension value as an em dash rather than "null"', () => {
    const out = pivotRows(spec, [{ d0: null, d0_label: null, m0: 1 }]);
    expect(out.rows[0]?.[dimKey(0)]).toBe('—');
  });
});

describe('pivotRows — with a column dimension', () => {
  const spec = specFor({
    rows: [{ field: 'stage' }],
    columns: [{ field: 'source' }],
    measures: [{ id: 'm1', field: '*', agg: 'count' }],
  });

  const long: LongRow[] = [
    { d0: 'new', d0_label: 'New', c0: 'web', c0_label: 'Web', m0: 10 },
    { d0: 'new', d0_label: 'New', c0: 'ref', c0_label: 'Referral', m0: 3 },
    { d0: 'won', d0_label: 'Won', c0: 'web', c0_label: 'Web', m0: 5 },
  ];

  it('collapses long rows into one row per row-axis group', () => {
    const out = pivotRows(spec, long);
    expect(out.rows).toHaveLength(2);
    expect(out.series.map((s) => s.label)).toEqual(['Web', 'Referral']);
  });

  it('keys cells by measure and series', () => {
    const out = pivotRows(spec, long);
    expect(out.rows[0]).toMatchObject({
      [dimKey(0)]: 'New',
      [cellKey('m1', 'web')]: 10,
      [cellKey('m1', 'ref')]: 3,
    });
  });

  it('fills a missing series cell with explicit null, not a missing key', () => {
    const out = pivotRows(spec, long);
    // 'Won' has no Referral row in the input.
    const won = out.rows[1];
    expect(won).toBeDefined();
    expect(cellKey('m1', 'ref') in (won ?? {})).toBe(true);
    expect(won?.[cellKey('m1', 'ref')]).toBeNull();
  });

  it('preserves series order as the query returned it', () => {
    // Deterministic series order is what keeps a series' colour stable between
    // runs of the same report.
    const out = pivotRows(spec, long);
    expect(out.series.map((s) => s.key)).toEqual(['web', 'ref']);
  });

  it('groups value columns measure-major', () => {
    const two = specFor({
      rows: [{ field: 'stage' }],
      columns: [{ field: 'source' }],
      measures: [
        { id: 'm1', field: '*', agg: 'count' },
        { id: 'm2', field: 'amount', agg: 'sum' },
      ],
    });
    const out = pivotRows(two, [
      { d0: 'new', c0: 'web', m0: 1, m1: 100 },
      { d0: 'new', c0: 'ref', m0: 2, m1: 200 },
    ]);
    expect(out.columns.filter((c) => c.role === 'measure').map((c) => c.key)).toEqual([
      cellKey('m1', 'web'),
      cellKey('m1', 'ref'),
      cellKey('m2', 'web'),
      cellKey('m2', 'ref'),
    ]);
  });
});

describe('pivotRows — two row dimensions', () => {
  it('treats the dimension tuple as the group identity', () => {
    const spec = specFor({ rows: [{ field: 'stage' }, { field: 'source' }] });
    const out = pivotRows(spec, [
      { d0: 'new', d1: 'web', m0: 1 },
      { d0: 'new', d1: 'ref', m0: 2 },
      { d0: 'won', d1: 'web', m0: 3 },
    ]);
    expect(out.rows).toHaveLength(3);
    expect(out.columns.map((c) => c.key)).toEqual([dimKey(0), dimKey(1), 'm1']);
  });

  it('distinguishes a null dimension from the string "null"', () => {
    const spec = specFor({ rows: [{ field: 'stage' }] });
    const out = pivotRows(spec, [
      { d0: null, m0: 1 },
      { d0: 'null', m0: 2 },
    ]);
    expect(out.rows).toHaveLength(2);
  });
});

describe('applyTopN', () => {
  const spec = specFor({ measures: [{ id: 'm1', field: '*', agg: 'count' }] });
  const long: LongRow[] = [
    { d0: 'a', m0: 100 },
    { d0: 'b', m0: 50 },
    { d0: 'c', m0: 5 },
    { d0: 'd', m0: 3 },
  ];

  it('keeps the top N and folds the rest into a summed Other row', () => {
    const out = applyTopN(spec, pivotRows(spec, long), 2, 'm1');
    expect(out.rows).toHaveLength(3);
    expect(out.rows[2]?.[dimKey(0)]).toBe('Other');
    // Other is a real total of the folded tail, not a discarded remainder.
    expect(out.rows[2]?.m1).toBe(8);
  });

  it('is a no-op when there are no more groups than N', () => {
    const pivot = pivotRows(spec, long);
    expect(applyTopN(spec, pivot, 10, 'm1')).toBe(pivot);
  });

  it('nulls the Other cell for a non-summable aggregation', () => {
    // An average of averages is wrong, so it is null rather than misleading.
    const avgSpec = specFor({ measures: [{ id: 'm1', field: 'amount', agg: 'avg' }] });
    const out = applyTopN(avgSpec, pivotRows(avgSpec, long), 2, 'm1');
    expect(out.rows[2]?.m1).toBeNull();
  });
});

describe('grandTotals', () => {
  it('sums count and sum measures', () => {
    const spec = specFor({
      measures: [
        { id: 'm1', field: '*', agg: 'count' },
        { id: 'm2', field: 'amount', agg: 'sum' },
      ],
    });
    const totals = grandTotals(
      spec,
      pivotRows(spec, [
        { d0: 'a', m0: 2, m1: 10 },
        { d0: 'b', m0: 3, m1: 20 },
      ]),
    );
    expect(totals).toEqual({ m1: 5, m2: 30 });
  });

  it('returns undefined when nothing is summable', () => {
    const spec = specFor({ measures: [{ id: 'm1', field: 'amount', agg: 'avg' }] });
    expect(grandTotals(spec, pivotRows(spec, [{ d0: 'a', m0: 5 }]))).toBeUndefined();
  });

  it('excludes count_distinct, which would double-count across groups', () => {
    // Summing per-group distinct counts counts a value appearing in two groups
    // twice. A wrong total is worse than an absent one.
    const spec = specFor({
      measures: [
        { id: 'm1', field: '*', agg: 'count' },
        { id: 'm2', field: 'lead_id', agg: 'count_distinct' },
      ],
    });
    const totals = grandTotals(
      spec,
      pivotRows(spec, [
        { d0: 'a', m0: 2, m1: 2 },
        { d0: 'b', m0: 3, m1: 3 },
      ]),
    );
    expect(totals?.m1).toBe(5);
    expect(totals?.m2).toBeNull();
  });
});
