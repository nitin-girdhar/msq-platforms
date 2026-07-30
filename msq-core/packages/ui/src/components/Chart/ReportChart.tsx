'use client';

// ── ReportChart ──────────────────────────────────────────────────────────────
// One component, every ChartType in @platform/reporting. It consumes a
// ReportResult EXACTLY as the /query endpoint returns it: rows are already
// pivoted wide and keyed by cellKey(measureId, seriesKey), and `result.series`
// is the render order. Nothing here re-pivots, re-sorts or re-aggregates — if a
// chart wants a different shape, that is a change to the spec, not to this file.
//
// Domain-free by construction: no dataset keys, no capability keys, no endpoint
// paths, no LMS/HR vocabulary. It is handed a spec and a result and draws them.
//
// THREE RULES THIS FILE EXISTS TO ENFORCE
//
//  1. A null cell is a GAP. Never zero, never a line connected across it.
//     `connectNulls` is false everywhere, and `toPlotValue` returns null rather
//     than coercing. A chart that draws a hole as a floor value is lying.
//  2. `meta.truncated` is visible. ChartFrame owns the banner; this file just
//     hands it the result.
//  3. Identity is never colour-alone. A legend is present at ≥2 series, and
//     ChartFrame's table toggle is always available — which is also the
//     mandatory relief for the three light-mode palette slots below 3:1.

import { useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import type { ReportCell, ReportResult, ReportSpec } from '@platform/reporting';

import ChartLegend from './ChartLegend';
import ChartFrame from './ChartFrame';
import ChartTooltip, { type TooltipPayloadEntry } from './ChartTooltip';
import DataTable from './DataTable';
import KpiRow from './KpiRow';
import { formatCompact, formatDimension, toPlotValue, truncateLabel } from './format';
import { chartTheme, seriesColor, SCATTER_SERIES_CAP, type ChartMode } from './palette';
import {
  resolveSeries,
  scatterXSeries,
  shouldShowLegend,
  xAxisKey,
  xAxisLabel,
  type DrawnSeries,
} from './series';

/** What `onPointClick` receives. Positional row index, because two groups can
 *  render identical dimension labels. */
export interface ChartPoint {
  rowIndex: number;
  row: Readonly<Record<string, ReportCell>>;
  /** Absent for a table row click or a KPI tile. */
  series?: DrawnSeries;
  value: number | null;
  /** The rendered category / x-axis label. */
  category: string;
}

export interface ReportChartProps {
  /** Normally `result.spec` (the spec as EXECUTED). Accepted separately so a
   *  builder can render a preview against a spec it has not yet run. */
  spec: ReportSpec;
  result?: ReportResult | undefined;
  loading?: boolean;
  error?: string | undefined;
  height?: number;
  /** Per-series colour override, keyed by the wide-row dataKey — i.e.
   *  cellKey(measureId, seriesKey). Wins over `encoding.colorOverrides`.
   *  Values must be literal hex; anything else is ignored. */
  palette?: Readonly<Record<string, string>>;
  onPointClick?: (point: ChartPoint) => void;
  emptyMessage?: string;
  /** The platform ships light only today (globals.css hard-codes it), so this
   *  defaults to light rather than sniffing `prefers-color-scheme` — a chart
   *  must not go dark on a page that stayed light. */
  mode?: ChartMode;
  title?: string;
  subtitle?: string;
  className?: string;
}

const DEFAULT_HEIGHT = 320;
const AXIS_LABEL_MAX = 18;
/** Chart margins. Left is generous because a y tick can be "1.2M". */
const MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Recharts' own payload entry types `dataKey` as `string | number | accessor
 * function`, and its optional props are not `| undefined` under
 * exactOptionalPropertyTypes. Normalise once here so ChartTooltip can keep a
 * narrow, honest contract instead of inheriting Recharts' looseness.
 */
function toTooltipEntries(payload: TooltipContentProps['payload']): TooltipPayloadEntry[] {
  if (payload === undefined) return [];
  return payload.map((entry) => {
    const key = entry.dataKey;
    return {
      ...(typeof key === 'string' || typeof key === 'number' ? { dataKey: key } : {}),
      value: entry.value,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(entry.color === undefined ? {} : { color: entry.color }),
      ...(entry.payload === undefined || entry.payload === null
        ? {}
        : { payload: entry.payload as Record<string, unknown> }),
    };
  });
}

function applyPaletteProp(
  series: readonly DrawnSeries[],
  palette: Readonly<Record<string, string>> | undefined,
): DrawnSeries[] {
  if (palette === undefined) return [...series];
  return series.map((s) => {
    const override = palette[s.dataKey];
    return override !== undefined && HEX.test(override) ? { ...s, color: override } : s;
  });
}

export default function ReportChart({
  spec,
  result,
  loading = false,
  error,
  height = DEFAULT_HEIGHT,
  palette,
  onPointClick,
  emptyMessage = 'No data for these filters.',
  mode = 'light',
  title,
  subtitle,
  className,
}: ReportChartProps): ReactNode {
  const theme = chartTheme(mode);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  const drawn = useMemo(
    () => (result === undefined ? [] : applyPaletteProp(resolveSeries(result, mode), palette)),
    [result, mode, palette],
  );
  const visible = useMemo(() => drawn.filter((s) => !hidden.has(s.dataKey)), [drawn, hidden]);

  const type = spec.chart.type;
  const isEmpty = result !== undefined && result.rows.length === 0;
  const rows = result?.rows ?? [];
  const xKey = result === undefined ? 'dim_0' : xAxisKey(result);
  const xLabel = result === undefined ? '' : xAxisLabel(result);

  const toggle = (dataKey: string): void => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      // Never let the reader hide the last visible series — an empty plot with
      // no explanation reads as broken.
      else if (drawn.length - next.size > 1) next.add(dataKey);
      return next;
    });
  };

  const emit = (rowIndex: number, series: DrawnSeries | undefined): void => {
    if (onPointClick === undefined || result === undefined) return;
    const row = result.rows[rowIndex];
    if (row === undefined) return;
    onPointClick({
      rowIndex,
      row,
      ...(series === undefined ? {} : { series }),
      value: series === undefined ? null : toPlotValue(row[series.dataKey]),
      category: formatDimension(row[xKey]),
    });
  };

  /**
   * Line and area marks are continuous paths, so Recharts' per-mark handler
   * reports the DOM event, not a row index — there is no single datum under a
   * click on a line segment. The chart-level handler does know which category
   * is active, so drill-down on those forms is category-scoped: `series` is
   * left undefined and the consumer gets the row. Bar, pie and scatter draw
   * discrete marks and do report the series.
   */
  const chartClick =
    onPointClick === undefined
      ? {}
      : {
          // Recharts types the active index as `number | string | null`
          // (a TooltipIndex), so coerce rather than assume.
          onClick: (state: { activeTooltipIndex?: number | string | null | undefined }) => {
            const index = Number(state.activeTooltipIndex);
            if (Number.isInteger(index) && index >= 0) emit(index, undefined);
          },
        };

  const tooltip = (showShare: boolean): ReactNode => (
    <Tooltip
      cursor={{ fill: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)' }}
      content={(props: TooltipContentProps) => (
        <ChartTooltip
          active={props.active ?? false}
          label={props.label}
          payload={toTooltipEntries(props.payload)}
          series={visible}
          mode={mode}
          {...(xLabel === '' ? {} : { labelPrefix: `${xLabel}:` })}
          showShare={showShare}
        />
      )}
    />
  );

  const axes = (horizontal: boolean): ReactNode => {
    const tick = { fill: theme.tokens.axis, fontSize: 11 };
    const category = (
      <XAxis
        key="x-cat"
        type={horizontal ? 'number' : 'category'}
        {...(horizontal ? {} : { dataKey: xKey })}
        tick={tick}
        tickLine={false}
        axisLine={{ stroke: theme.tokens.grid }}
        tickFormatter={
          horizontal
            ? (v: number) => formatCompact(v)
            : (v: unknown) => truncateLabel(formatDimension(v as ReportCell), AXIS_LABEL_MAX)
        }
        interval="preserveStartEnd"
        minTickGap={8}
      />
    );
    const value = (
      <YAxis
        key="y-val"
        type={horizontal ? 'category' : 'number'}
        {...(horizontal ? { dataKey: xKey, width: 120 } : { width: 56 })}
        tick={tick}
        tickLine={false}
        axisLine={{ stroke: theme.tokens.grid }}
        tickFormatter={
          horizontal
            ? (v: unknown) => truncateLabel(formatDimension(v as ReportCell), AXIS_LABEL_MAX)
            : (v: number) => formatCompact(v)
        }
        {...(spec.chart.encoding.yAxisLabel === undefined || horizontal
          ? {}
          : {
              label: {
                value: spec.chart.encoding.yAxisLabel,
                angle: -90,
                position: 'insideLeft',
                style: { fill: theme.tokens.axis, fontSize: 11 },
              },
            })}
      />
    );
    return (
      <>
        {category}
        {value}
      </>
    );
  };

  const grid = (horizontal: boolean): ReactNode => (
    // Recessive by design: hairline, one direction only. A full lattice
    // competes with the marks it exists to support.
    <CartesianGrid
      stroke={theme.tokens.grid}
      strokeDasharray="0"
      vertical={horizontal}
      horizontal={!horizontal}
    />
  );

  /** Wide rows with measure cells coerced to number|null. A hole stays null so
   *  Recharts leaves a gap; coercing to 0 here is the single most common way a
   *  chart of this kind starts lying. */
  const plotRows = useMemo(
    () =>
      rows.map((row) => {
        const out: Record<string, ReportCell | number | null> = { ...row };
        for (const s of drawn) out[s.dataKey] = toPlotValue(row[s.dataKey]);
        return out;
      }),
    [rows, drawn],
  );

  const chartBody = ((): ReactNode => {
    if (result === undefined) return null;

    switch (type) {
      case 'table':
        return (
          <DataTable
            result={result}
            mode={mode}
            {...(onPointClick === undefined ? {} : { onRowClick: (i: number) => emit(i, undefined) })}
          />
        );

      case 'kpi':
        return <KpiRow result={result} mode={mode} />;

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={plotRows} margin={MARGIN} {...chartClick}>
              {grid(false)}
              {axes(false)}
              {tooltip(false)}
              <Legend content={() => null} />
              {visible.map((s) => (
                <Line
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  // The gap rule, stated twice: null values are not connected.
                  connectNulls={false}
                  dot={{ r: 2.5, fill: s.color, stroke: theme.tokens.surface, strokeWidth: 2 }}
                  activeDot={{ r: 4.5, stroke: theme.tokens.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={plotRows} margin={MARGIN} {...chartClick}>
              {grid(false)}
              {axes(false)}
              {tooltip(spec.chart.encoding.stacked === true)}
              <Legend content={() => null} />
              {visible.map((s) => (
                <Area
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.18}
                  connectNulls={false}
                  {...(spec.chart.encoding.stacked === true ? { stackId: 'stack' } : {})}
                  dot={false}
                  activeDot={{ r: 4.5, stroke: theme.tokens.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'bar':
      case 'bar_stacked':
      case 'bar_horizontal': {
        const horizontal = type === 'bar_horizontal';
        const stacked = type === 'bar_stacked' || spec.chart.encoding.stacked === true;
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={plotRows}
              layout={horizontal ? 'vertical' : 'horizontal'}
              margin={MARGIN}
              barCategoryGap="20%"
            >
              {grid(horizontal)}
              {axes(horizontal)}
              {tooltip(stacked)}
              <Legend content={() => null} />
              {visible.map((s, i) => {
                // 4px rounded data-END only, anchored to the baseline. In a
                // stack only the last segment carries the cap, or the rounding
                // reads as a gap between segments.
                const isCap = !stacked || i === visible.length - 1;
                const radius: [number, number, number, number] = horizontal
                  ? isCap
                    ? [0, 4, 4, 0]
                    : [0, 0, 0, 0]
                  : isCap
                    ? [4, 4, 0, 0]
                    : [0, 0, 0, 0];
                return (
                  <Bar
                    key={s.dataKey}
                    dataKey={s.dataKey}
                    name={s.label}
                    fill={s.color}
                    radius={radius}
                    // The 2px surface gap between adjacent fills — stacked
                    // segments and neighbouring bars alike.
                    stroke={theme.tokens.surface}
                    strokeWidth={2}
                    {...(stacked ? { stackId: 'stack' } : {})}
                    isAnimationActive={false}
                    {...(onPointClick === undefined
                      ? {}
                      : { onClick: (_: unknown, index: number) => emit(index, s) })}
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        );
      }

      case 'pie':
      case 'donut': {
        // A pie is one dimension as slices and one measure as size — enforced by
        // CHART_SHAPE_RULES, so there is exactly one drawn series here.
        const s = visible[0] ?? drawn[0];
        if (s === undefined) return null;
        const sliceRows = plotRows
          .map((row, rowIndex) => ({ row, rowIndex, value: toPlotValue(row[s.dataKey]) }))
          // A null slice has no angle to occupy. Dropping it is the gap rule's
          // pie-chart form; rendering it as 0 would add a phantom legend entry.
          .filter((d): d is { row: Record<string, ReportCell | number | null>; rowIndex: number; value: number } =>
            d.value !== null && d.value > 0,
          );
        if (sliceRows.length === 0) return null;
        const total = sliceRows.reduce((sum, d) => sum + d.value, 0);
        return (
          <>
            <ResponsiveContainer width="100%" height={height}>
              <PieChart margin={MARGIN}>
                <Tooltip
                  content={(props: TooltipContentProps) => {
                    const entry = toTooltipEntries(props.payload)[0];
                    const name = entry?.payload?.['__label'];
                    return (
                      <ChartTooltip
                        active={props.active ?? false}
                        label={typeof name === 'string' ? name : undefined}
                        payload={entry === undefined ? [] : [{ ...entry, dataKey: s.dataKey }]}
                        series={[s]}
                        mode={mode}
                        showShare
                      />
                    );
                  }}
                />
                <Pie
                  data={sliceRows.map((d) => ({
                    ...d.row,
                    __label: formatDimension(d.row[xKey]),
                    __value: d.value,
                    __rowIndex: d.rowIndex,
                  }))}
                  dataKey="__value"
                  nameKey="__label"
                  innerRadius={type === 'donut' ? '55%' : 0}
                  outerRadius="80%"
                  // 2px surface ring between slices — the same spacer rule as a
                  // stacked bar, which is what a pie is in polar coordinates.
                  stroke={theme.tokens.surface}
                  strokeWidth={2}
                  paddingAngle={1}
                  isAnimationActive={false}
                  {...(onPointClick === undefined
                    ? {}
                    : {
                        onClick: (_: unknown, index: number) => {
                          const slice = sliceRows[index];
                          if (slice !== undefined) emit(slice.rowIndex, s);
                        },
                      })}
                >
                  {sliceRows.map((d, i) => (
                    // Slices are categorical identity, so each takes the next
                    // fixed slot — never a value-derived shade.
                    <Cell key={d.rowIndex} fill={seriesColor(i, undefined, mode)} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* A pie's legend IS its axis — there is no other way to name a
                slice, so it is never suppressed here. */}
            <ChartLegend
              className="mt-2 justify-center"
              mode={mode}
              series={sliceRows.map((d, i) => ({
                dataKey: `slice-${d.rowIndex}`,
                label: `${formatDimension(d.row[xKey])} · ${((d.value / total) * 100).toFixed(0)}%`,
                color: seriesColor(i, undefined, mode),
                measureId: s.measureId,
                measure: s.measure,
              }))}
            />
          </>
        );
      }

      case 'scatter': {
        const x = scatterXSeries(result, mode);
        if (x === undefined) {
          return (
            <div
              className="flex items-center justify-center px-6 text-center text-sm"
              style={{ height, color: theme.tokens.textMuted }}
            >
              A scatter chart needs a second value on its x axis, and this report&rsquo;s
              x-axis value is not one of its measures.
            </div>
          );
        }
        // Any two points can end up adjacent, so the all-pairs series cap binds
        // here — three, not eight. Past that, fold or facet.
        const clouds = visible.filter((s) => s.dataKey !== x.dataKey).slice(0, SCATTER_SERIES_CAP);
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart margin={{ ...MARGIN, left: 8, bottom: 8 }}>
              <CartesianGrid stroke={theme.tokens.grid} />
              <XAxis
                type="number"
                dataKey={x.dataKey}
                name={x.label}
                tick={{ fill: theme.tokens.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: theme.tokens.grid }}
                tickFormatter={(v: number) => formatCompact(v, x.measure.format)}
              />
              <YAxis
                type="number"
                dataKey={clouds[0]?.dataKey ?? x.dataKey}
                name={clouds[0]?.label ?? x.label}
                width={56}
                tick={{ fill: theme.tokens.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: theme.tokens.grid }}
                tickFormatter={(v: number) => formatCompact(v, clouds[0]?.measure.format)}
              />
              {tooltip(false)}
              {clouds.map((s) => (
                <Scatter
                  key={s.dataKey}
                  name={s.label}
                  // A point with a null on either axis is dropped, not floored.
                  data={plotRows.filter(
                    (r) => toPlotValue(r[x.dataKey]) !== null && toPlotValue(r[s.dataKey]) !== null,
                  )}
                  fill={s.color}
                  // ≥8px marker, with the 2px surface ring so overlapping points
                  // stay countable.
                  shape="circle"
                  stroke={theme.tokens.surface}
                  strokeWidth={2}
                  isAnimationActive={false}
                  {...(onPointClick === undefined
                    ? {}
                    : { onClick: (_: unknown, index: number) => emit(index, s) })}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        );
      }
    }
  })();

  const wantsLegend =
    result !== undefined &&
    type !== 'table' &&
    type !== 'kpi' &&
    type !== 'pie' &&
    type !== 'donut' &&
    shouldShowLegend(result, drawn);

  return (
    <ChartFrame
      {...(title === undefined ? {} : { title })}
      {...(subtitle === undefined ? {} : { subtitle })}
      result={result}
      loading={loading}
      error={error}
      empty={isEmpty}
      emptyMessage={emptyMessage}
      height={height}
      mode={mode}
      // The table view is the mandatory relief channel for the sub-3:1 light
      // slots, so it is offered for every chart form except the table itself
      // (which already IS one) and a KPI row (whose tiles are already text).
      {...(result === undefined || type === 'table' || type === 'kpi'
        ? {}
        : { tableView: <DataTable result={result} mode={mode} /> })}
      {...(className === undefined ? {} : { className })}
    >
      {wantsLegend && (
        <ChartLegend className="mb-2" series={drawn} mode={mode} hidden={hidden} onToggle={toggle} />
      )}
      {chartBody}
    </ChartFrame>
  );
}
