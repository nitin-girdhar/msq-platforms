// ── Chart primitives ─────────────────────────────────────────────────────────
// Domain-free rendering for @platform/reporting results. These components know
// about a ReportSpec and a ReportResult and NOTHING else — no dataset keys, no
// capability keys, no endpoint paths, no LMS/HR vocabulary. Fetching, saving
// and permission gating all live in the product app that composes them.
//
// This folder may import @platform/reporting's "." entry ONLY. Never "./sql":
// that entry reaches drizzle, and a boundary test in the reporting package
// asserts "." does not. Importing "./sql" here would ship dataset SQL fragments
// into a browser bundle.

export { default as ReportChart, type ChartPoint, type ReportChartProps } from './ReportChart';
export { default as ChartFrame, type ChartFrameProps } from './ChartFrame';
export { default as ChartTooltip, type ChartTooltipProps, type TooltipPayloadEntry } from './ChartTooltip';
export { default as ChartLegend, type ChartLegendProps } from './ChartLegend';
export { default as Sparkline, type SparklineProps } from './Sparkline';
export { default as KpiTile, type KpiTileProps } from './KpiTile';
export { default as KpiRow, type KpiRowProps } from './KpiRow';
export { default as DataTable, type DataTableProps } from './DataTable';

export {
  CATEGORICAL_SLOTS,
  CHART_PALETTE,
  CHART_PALETTE_DARK,
  CHART_TOKENS,
  CHART_TOKENS_DARK,
  SCATTER_SERIES_CAP,
  chartTheme,
  deltaColor,
  exceedsSlots,
  isChartColor,
  overrideFor,
  sequentialColor,
  seriesColor,
  type ChartMode,
  type ChartPalette,
  type ChartTheme,
  type ChartTokens,
} from './palette';

export {
  EMPTY_CELL,
  formatCompact,
  formatDimension,
  formatDurationMinutes,
  formatElapsed,
  formatMeasure,
  formatShare,
  shareOf,
  toPlotValue,
  truncateLabel,
} from './format';

export {
  drawnMeasures,
  resolveSeries,
  scatterXSeries,
  shouldShowLegend,
  xAxisKey,
  xAxisLabel,
  type DrawnSeries,
} from './series';
