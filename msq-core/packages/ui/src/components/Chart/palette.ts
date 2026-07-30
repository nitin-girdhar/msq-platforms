// ── Chart palette ────────────────────────────────────────────────────────────
// Plain hex strings, not CSS custom properties: Recharts wants concrete
// `fill`/`stroke` values, and this repo has no custom-property layer to lean on.
//
// PROVENANCE — do not hand-edit a hex here. Every value below started as a
// documented step from the `dataviz` skill's reference palette
// (references/palette.md) and was re-validated with that skill's
// scripts/validate_palette.js against THIS platform's real surfaces
// (light #ffffff — the card background every chart sits on; dark #0F172A — the
// platform's own ink colour, the natural dark surface). Values were never
// sampled out of Tailwind class strings and never eyeballed.
//
// The one deliberate deviation from the reference values: categorical slot 1 in
// light mode was nudged from the reference `#2a78d6` (blue ramp step 450) one
// step down to `#256abf` (step 500), because that is the documented step
// nearest the platform's existing accent `#0b6cbf` (Button, MultiSelect,
// UserPicker, MonthGrid). Hue family held, lightness moved by exactly one
// documented step, palette re-validated as a set afterwards — the skill's
// "snap-to-passing" procedure. No other slot moved.
//
// VALIDATION RESULTS (validate_palette.js, at the time of writing):
//
//   categorical light, surface #ffffff, adjacent pairs
//     lightness band PASS · chroma floor PASS
//     CVD separation PASS  worst #eda100↔#1baf7a ΔE 9.1 (protan)
//     normal-vision  PASS  worst #e87ba4↔#eda100 ΔE 19.6
//     contrast       WARN  #1baf7a 2.82 · #eda100 2.17 · #e87ba4 2.69  ← see RELIEF
//   categorical dark, surface #0F172A, adjacent pairs   ALL PASS
//     CVD worst #c98500↔#199e70 ΔE 8.4 · normal-vision worst ΔE 19.3 · contrast all ≥3:1
//   categorical, --pairs all (scatter/bubble), first 3 slots  ALL PASS both modes
//     light worst CVD ΔE 9.2 · dark worst CVD ΔE 9.4     ← hence SCATTER_SERIES_CAP
//   sequential + both diverging arms, --ordinal, both modes  ALL PASS
//     monotone L · adjacent ΔL ≥ 0.06 · light end ≥ 2:1 · single hue
//
// RELIEF (mandatory, not optional): three light-mode slots sit below 3:1 on
// white. The skill's contrast WARN is not dismissable — it obligates a relief
// channel. Ours is ChartFrame's built-in **table view toggle**, present on every
// chart, plus the legend that is always rendered for ≥2 series. Do not remove
// either without re-reading this block.

import type { ReportResult } from '@platform/reporting';

export type ChartMode = 'light' | 'dark';

export interface ChartPalette {
  /** Series identity. Assigned in fixed order, NEVER cycled — see seriesColor. */
  readonly categorical: readonly string[];
  /** Magnitude. One hue, light→dark. */
  readonly sequential: readonly string[];
  /** Polarity. Two hues either side of a neutral gray midpoint, equal arms. */
  readonly diverging: readonly string[];
}

export interface ChartTokens {
  /** Axis line + tick labels. Text-contrast safe on `surface`. */
  readonly axis: string;
  /** Hairline gridlines. Decorative — never carries meaning. */
  readonly grid: string;
  readonly text: string;
  readonly textMuted: string;
  readonly surface: string;
  /** Status. Reserved meaning; always shipped with a label, never colour alone. */
  readonly positive: string;
  readonly negative: string;
  readonly neutral: string;
}

/** Light mode — the only mode this platform ships today (globals.css hard-codes
 *  a light background), so this is the default everywhere. */
export const CHART_PALETTE: ChartPalette = {
  categorical: [
    '#256abf', // 1 blue     — nudged toward the platform accent #0b6cbf
    '#eb6834', // 2 orange
    '#1baf7a', // 3 aqua
    '#eda100', // 4 yellow
    '#e87ba4', // 5 magenta
    '#008300', // 6 green
    '#4a3aa7', // 7 violet
    '#e34948', // 8 red
  ],
  sequential: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  diverging: ['#184f95', '#5178ad', '#7b98bf', '#f0efec', '#f19b93', '#ec7a73', '#e34948'],
} as const;

export const CHART_PALETTE_DARK: ChartPalette = {
  categorical: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  sequential: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
  diverging: ['#3987e5', '#3d6ea9', '#3d5d82', '#383835', '#86504c', '#ac5a57', '#e66767'],
} as const;

export const CHART_TOKENS: ChartTokens = {
  axis: '#64748B', //  4.76:1 on #ffffff — tick labels are text, so this clears 4.5
  grid: '#E2E8F0', //  1.23:1 — hairline only, deliberately recessive
  text: '#0F172A', // 17.85:1
  textMuted: '#475569', //  7.58:1
  surface: '#ffffff',
  positive: '#006300', //  7.54:1 — the skill's light success-TEXT step, so deltas are readable
  negative: '#d03b3b', //  4.80:1 — status "critical"
  neutral: '#64748B', //  4.76:1
} as const;

export const CHART_TOKENS_DARK: ChartTokens = {
  axis: '#94A3B8', //  6.96:1 on #0F172A
  grid: '#1E293B', //  1.22:1
  text: '#F1F5F9', // 16.30:1
  textMuted: '#CBD5E1', // 12.02:1
  surface: '#0F172A',
  positive: '#0ca30c', //  5.32:1 — the skill's dark success step
  negative: '#e66767', //  5.53:1
  neutral: '#94A3B8', //  6.96:1
} as const;

export interface ChartTheme {
  readonly mode: ChartMode;
  readonly palette: ChartPalette;
  readonly tokens: ChartTokens;
}

export function chartTheme(mode: ChartMode = 'light'): ChartTheme {
  return mode === 'dark'
    ? { mode, palette: CHART_PALETTE_DARK, tokens: CHART_TOKENS_DARK }
    : { mode, palette: CHART_PALETTE, tokens: CHART_TOKENS };
}

/**
 * Series cap for chart forms where ANY two marks can end up adjacent — scatter,
 * bubble, choropleth, small multiples. The palette validates all-pairs with its
 * first three slots only; past that no ordering of eight hues clears the floors.
 * Beyond this, fold to "Other" or facet. (Adjacent-pair forms — line, area,
 * bar, stacked bar, pie — validate the full eight.)
 */
export const SCATTER_SERIES_CAP = 3;

/** How many distinct hues exist. A 9th series is NOT a generated hue. */
export const CATEGORICAL_SLOTS = CHART_PALETTE.categorical.length;

/** Overrides arrive from `spec.chart.encoding.colorOverrides`, which is spec
 *  data — i.e. untrusted text that ends up in a `fill=` attribute (and, in
 *  Phase 7, in an inline style in an email). Only a literal hex gets through. */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isChartColor(value: string | undefined): value is string {
  return value !== undefined && HEX.test(value);
}

/**
 * The colour for series `index`, in fixed slot order.
 *
 * Colour follows the ENTITY, never its rank: callers must pass the series'
 * stable position in `result.series` (or in the measure list), not its position
 * after a filter removed some of them — otherwise a filter change repaints the
 * survivors and the reader re-learns the chart.
 *
 * Past slot 8 the palette does not invent a hue; it wraps, and the caller is
 * expected to have folded the tail into "Other" long before that. `ChartFrame`
 * surfaces a warning when a chart exceeds the slot count.
 */
export function seriesColor(index: number, override?: string, mode: ChartMode = 'light'): string {
  if (isChartColor(override)) return override;
  const slots = mode === 'dark' ? CHART_PALETTE_DARK.categorical : CHART_PALETTE.categorical;
  // Non-null: slots is a non-empty literal tuple, and the modulo is in range.
  return slots[((index % slots.length) + slots.length) % slots.length] as string;
}

/** A sequential step for a value in [0,1]. Clamped, never extrapolated. */
export function sequentialColor(t: number, mode: ChartMode = 'light'): string {
  const ramp = mode === 'dark' ? CHART_PALETTE_DARK.sequential : CHART_PALETTE.sequential;
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return ramp[Math.min(ramp.length - 1, Math.floor(clamped * ramp.length))] as string;
}

/** Convenience for a KPI delta: the status token matching a signed change.
 *  Callers MUST also render an arrow/label — a status colour never carries
 *  meaning on its own. */
export function deltaColor(delta: number, mode: ChartMode = 'light'): string {
  const tokens = mode === 'dark' ? CHART_TOKENS_DARK : CHART_TOKENS;
  if (delta > 0) return tokens.positive;
  if (delta < 0) return tokens.negative;
  return tokens.neutral;
}

/**
 * Resolve a colour override for a drawn series.
 *
 * `colorOverrides` is documented as keyed "by series key or measure id", so
 * both are looked up — series key first, since it is the more specific of the
 * two when a spec has a column dimension.
 */
export function overrideFor(
  overrides: Readonly<Record<string, string>> | undefined,
  measureId: string,
  seriesKey: string | undefined,
): string | undefined {
  if (overrides === undefined) return undefined;
  if (seriesKey !== undefined) {
    const bySeries = overrides[seriesKey];
    if (isChartColor(bySeries)) return bySeries;
  }
  const byMeasure = overrides[measureId];
  return isChartColor(byMeasure) ? byMeasure : undefined;
}

/** True when a result would need more hues than the palette has slots. */
export function exceedsSlots(result: Pick<ReportResult, 'series' | 'spec'>): boolean {
  const seriesCount = Math.max(result.series.length, 1);
  return seriesCount * result.spec.measures.length > CATEGORICAL_SLOTS;
}
