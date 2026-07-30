// Chart-primitive unit tests. Pure logic only — palette, formatting and series
// resolution. No DOM: ui-kit's vitest runs in `node`, and the assertions worth
// making here are about colour assignment and null handling, both of which are
// decided long before anything renders.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { cellKey } from '@platform/reporting';

import {
  EMPTY_CELL,
  formatCompact,
  formatDurationMinutes,
  formatMeasure,
  formatShare,
  shareOf,
  toPlotValue,
  truncateLabel,
} from '../format';
import {
  CATEGORICAL_SLOTS,
  CHART_PALETTE,
  CHART_PALETTE_DARK,
  CHART_TOKENS,
  CHART_TOKENS_DARK,
  deltaColor,
  exceedsSlots,
  isChartColor,
  overrideFor,
  sequentialColor,
  seriesColor,
} from '../palette';
import { drawnMeasures, resolveSeries, scatterXSeries, shouldShowLegend, xAxisKey } from '../series';
import { result, seriesResult, spec } from './fixtures';

const CHART_DIR = join(__dirname, '..');

describe('palette', () => {
  it('assigns categorical hues in fixed order', () => {
    // The ORDER is the CVD-safety mechanism, not cosmetics. If this fails,
    // someone re-ordered the slots and the validator has to be re-run.
    expect(CHART_PALETTE.categorical).toEqual([
      '#256abf',
      '#eb6834',
      '#1baf7a',
      '#eda100',
      '#e87ba4',
      '#008300',
      '#4a3aa7',
      '#e34948',
    ]);
    expect(CHART_PALETTE_DARK.categorical).toHaveLength(CATEGORICAL_SLOTS);
  });

  it('never generates a hue — a 9th series wraps to slot 1', () => {
    expect(seriesColor(0)).toBe(CHART_PALETTE.categorical[0]);
    expect(seriesColor(CATEGORICAL_SLOTS)).toBe(CHART_PALETTE.categorical[0]);
    // Negative indices must not fall off the end either.
    expect(seriesColor(-1)).toBe(CHART_PALETTE.categorical[CATEGORICAL_SLOTS - 1]);
  });

  it('serves the dark steps in dark mode', () => {
    expect(seriesColor(1, undefined, 'dark')).toBe(CHART_PALETTE_DARK.categorical[1]);
    expect(seriesColor(1, undefined, 'light')).toBe(CHART_PALETTE.categorical[1]);
  });

  it('accepts a hex override and rejects everything else', () => {
    // colorOverrides is spec data — untrusted text that lands in a fill=
    // attribute and, in phase 7, in an inline style in an email.
    expect(seriesColor(0, '#abcdef')).toBe('#abcdef');
    expect(seriesColor(0, '#abc')).toBe('#abc');
    for (const hostile of [
      'red',
      'url(javascript:alert(1))',
      'expression(alert(1))',
      '#abcdefg',
      '#12345',
      'rgb(1,2,3)',
      '',
      '#abc;background:url(x)',
    ]) {
      expect(isChartColor(hostile)).toBe(false);
      expect(seriesColor(0, hostile)).toBe(CHART_PALETTE.categorical[0]);
    }
  });

  it('prefers a series-key override over a measure-id one', () => {
    const overrides = { m_a: '#111111', won: '#222222' };
    expect(overrideFor(overrides, 'm_a', 'won')).toBe('#222222');
    expect(overrideFor(overrides, 'm_a', 'new')).toBe('#111111');
    expect(overrideFor(overrides, 'm_z', 'new')).toBeUndefined();
    expect(overrideFor(undefined, 'm_a', 'won')).toBeUndefined();
  });

  it('clamps the sequential ramp instead of extrapolating', () => {
    expect(sequentialColor(-5)).toBe(CHART_PALETTE.sequential[0]);
    expect(sequentialColor(1)).toBe(CHART_PALETTE.sequential[CHART_PALETTE.sequential.length - 1]);
    expect(sequentialColor(Number.NaN)).toBe(CHART_PALETTE.sequential[0]);
  });

  it('maps a delta sign onto a status token', () => {
    expect(deltaColor(1)).toBe(CHART_TOKENS.positive);
    expect(deltaColor(-1)).toBe(CHART_TOKENS.negative);
    expect(deltaColor(0)).toBe(CHART_TOKENS.neutral);
    expect(deltaColor(1, 'dark')).toBe(CHART_TOKENS_DARK.positive);
  });

  it('flags a result needing more hues than there are slots', () => {
    expect(exceedsSlots(result())).toBe(false);
    expect(exceedsSlots(seriesResult())).toBe(false); // 2 measures × 2 series = 4
    expect(
      exceedsSlots({
        spec: spec({ measures: [{ id: 'm_a', field: '*', agg: 'count' }] }),
        series: Array.from({ length: 9 }, (_, i) => ({ key: `s${i}`, label: `S${i}` })),
      }),
    ).toBe(true);
  });

  it('exposes every token both modes need', () => {
    for (const tokens of [CHART_TOKENS, CHART_TOKENS_DARK]) {
      for (const key of ['axis', 'grid', 'text', 'textMuted', 'surface', 'positive', 'negative', 'neutral'] as const) {
        expect(tokens[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});

describe('format', () => {
  it('renders a null cell as a dash, never as zero', () => {
    // This is the single most important assertion in the file. A hole rendered
    // as 0 is a false statement about the data.
    expect(formatMeasure(null)).toBe(EMPTY_CELL);
    expect(formatMeasure(undefined)).toBe(EMPTY_CELL);
    expect(formatMeasure(0)).toBe('0');
    expect(formatCompact(null)).toBe(EMPTY_CELL);
    expect(toPlotValue(null)).toBeNull();
    expect(toPlotValue(undefined)).toBeNull();
    expect(toPlotValue(0)).toBe(0);
    expect(toPlotValue('not a number')).toBeNull();
    expect(toPlotValue(Number.NaN)).toBeNull();
  });

  it('honours the measure format', () => {
    expect(formatMeasure(12.345, { kind: 'percent' })).toBe('12.3%');
    expect(formatMeasure(12.345, { kind: 'percent', decimals: 0 })).toBe('12%');
    expect(formatMeasure(90, { kind: 'duration_minutes' })).toBe('1h 30m');
    expect(formatDurationMinutes(45)).toBe('45m');
    expect(formatDurationMinutes(1500)).toBe('1d 1h');
    expect(formatDurationMinutes(-45)).toBe('-45m');
  });

  it('abbreviates only for axis ticks', () => {
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(15000)).toBe('15k');
    expect(formatCompact(2_400_000)).toBe('2.4M');
    expect(formatCompact(999)).toBe('999');
    // The full value is what a tooltip and a table show.
    expect(formatMeasure(2_400_000)).toBe(new Intl.NumberFormat(undefined).format(2400000));
  });

  it('distinguishes "no share" from "zero share"', () => {
    expect(shareOf(5, 0)).toBeNull();
    expect(shareOf(null, 100)).toBeNull();
    expect(shareOf(0, 100)).toBe(0);
    expect(formatShare(null, 100)).toBe(EMPTY_CELL);
    expect(formatShare(25, 100)).toBe('25%');
  });

  it('truncates a long axis label', () => {
    expect(truncateLabel('short', 10)).toBe('short');
    expect(truncateLabel('a-very-long-category-name', 10)).toBe('a-very-lo…');
  });
});

describe('series resolution', () => {
  it('reads the wide keys the server produced', () => {
    const drawn = resolveSeries(result());
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.dataKey).toBe(cellKey('m_a'));
  });

  it('is measure-major and matches the pivot column order', () => {
    const drawn = resolveSeries(seriesResult());
    expect(drawn.map((d) => d.dataKey)).toEqual([
      cellKey('m_a', 'new'),
      cellKey('m_a', 'won'),
      cellKey('m_b', 'new'),
      cellKey('m_b', 'won'),
    ]);
    expect(drawn.map((d) => d.color)).toEqual(CHART_PALETTE.categorical.slice(0, 4));
  });

  it('does not repaint the survivors when a measure is hidden', () => {
    // Colour follows the entity, never its rank. Dropping m_a from the encoding
    // must leave m_b on the slots it already had.
    const base = seriesResult();
    const full = resolveSeries(base);
    const filtered = resolveSeries({
      ...base,
      spec: { ...base.spec, chart: { ...base.spec.chart, encoding: { measures: ['m_b'] } } },
    });
    const colourOf = (list: readonly { dataKey: string; color: string }[], key: string): string | undefined =>
      list.find((d) => d.dataKey === key)?.color;

    expect(filtered.map((d) => d.dataKey)).toEqual([cellKey('m_b', 'new'), cellKey('m_b', 'won')]);
    expect(colourOf(filtered, cellKey('m_b', 'new'))).toBe(colourOf(full, cellKey('m_b', 'new')));
    expect(colourOf(filtered, cellKey('m_b', 'won'))).toBe(colourOf(full, cellKey('m_b', 'won')));
  });

  it('falls back to every measure rather than drawing nothing', () => {
    const base = result();
    const empty = {
      ...base,
      spec: { ...base.spec, chart: { ...base.spec.chart, encoding: { measures: [] } } },
    };
    expect(drawnMeasures(empty)).toHaveLength(1);
    expect(resolveSeries(empty)).toHaveLength(1);
  });

  it('excludes the scatter x measure from the drawn set', () => {
    const base = seriesResult();
    const scatter = {
      ...base,
      spec: {
        ...base.spec,
        chart: { type: 'scatter' as const, encoding: { measures: ['m_b'], xMeasure: 'm_a' } },
      },
    };
    expect(drawnMeasures(scatter).map((m) => m.id)).toEqual(['m_b']);
    expect(scatterXSeries(scatter)?.measureId).toBe('m_a');
  });

  it('returns no x series when xMeasure names nothing', () => {
    const base = result();
    expect(
      scatterXSeries({
        ...base,
        spec: {
          ...base.spec,
          chart: { type: 'scatter', encoding: { measures: ['m_a'], xMeasure: 'nope' } },
        },
      }),
    ).toBeUndefined();
  });

  it('clamps xFromRow to a row that exists', () => {
    const base = result();
    expect(xAxisKey(base)).toBe('dim_0');
    expect(
      xAxisKey({
        ...base,
        spec: { ...base.spec, chart: { ...base.spec.chart, encoding: { measures: ['m_a'], xFromRow: 7 } } },
      }),
    ).toBe('dim_0');
  });

  it('shows a legend at two series and hides it at one', () => {
    const one = result();
    expect(shouldShowLegend(one, resolveSeries(one))).toBe(false);
    const many = seriesResult();
    expect(shouldShowLegend(many, resolveSeries(many))).toBe(true);
    // showLegend can suppress, but nothing turns it on for a single series.
    expect(
      shouldShowLegend(
        { ...many, spec: { ...many.spec, chart: { ...many.spec.chart, encoding: { measures: ['m_a', 'm_b'], showLegend: false } } } },
        resolveSeries(many),
      ),
    ).toBe(false);
  });
});

describe('the reporting boundary', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sources(full);
      return /\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  it('imports @platform/reporting only through its browser-safe "." entry', () => {
    // "./sql" reaches drizzle and the dataset definitions. Importing it here
    // would ship a product's SQL fragments into a client bundle — and would
    // falsify the boundary test in the reporting package.
    const offenders = sources(CHART_DIR)
      .filter((file) => /from\s*['"]@platform\/reporting\/[^'"]+['"]/.test(readFileSync(file, 'utf8')))
      .map((f) => relative(CHART_DIR, f));
    expect(offenders).toEqual([]);
  });

  it('holds no domain knowledge', () => {
    // The barrel's rule, made mechanical. ui-kit is shared by LMS, HR and Task;
    // a dataset key or an endpoint path here is a boundary violation that
    // depcruise cannot see.
    const offenders: string[] = [];
    for (const file of sources(CHART_DIR)) {
      const src = readFileSync(file, 'utf8')
        // Prose in comments legitimately names products when explaining WHY a
        // rule exists; only code is scanned.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/\/api\/v1\/|\blms\.|\bhr\.reports\b|CAPABILITY\./.test(src)) {
        offenders.push(relative(CHART_DIR, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
