// ── Value formatting for charts ──────────────────────────────────────────────
// Pure, no React, no domain knowledge. `MeasureFormat` comes off the spec, so
// the same measure formats identically in a tile, an axis tick, a tooltip and a
// table cell — which is the whole point of putting it here rather than inline.
//
// The rule that matters most in this file: NULL IS NOT ZERO. A missing cell is
// a hole in the data and must render as an em dash, never as "0". Charts follow
// the same rule geometrically (a gap, not a point on the baseline).

import type { MeasureFormat, ReportCell } from '@platform/reporting';

/** What an absent measure cell renders as. Never "0", never "". */
export const EMPTY_CELL = '—';

/** Locale is deliberately undefined = the viewer's. The platform is single-locale
 *  today; hard-coding 'en-IN' here would be a domain assumption ui-kit must not
 *  make, and Intl already does the right thing per user. */
const LOCALE: string | undefined = undefined;

function decimalsFor(format: MeasureFormat | undefined): number {
  if (format?.decimals !== undefined) return Math.min(6, Math.max(0, format.decimals));
  switch (format?.kind) {
    case 'percent':
      return 1;
    case 'currency':
      return 2;
    case 'duration_minutes':
      return 0;
    default:
      return 0;
  }
}

/** Minutes → "3h 20m" / "45m" / "2d 4h". Chosen over a decimal-hours number
 *  because a duration axis is read, not computed with. */
export function formatDurationMinutes(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? '-' : '';
  const mins = Math.round(Math.abs(totalMinutes));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${rest}m`;
  return `${sign}${rest}m`;
}

/**
 * Format a measure value for display.
 *
 * `null` (and anything non-numeric that reached a measure column) returns
 * EMPTY_CELL. Callers rendering into a chart must NOT substitute 0 for this.
 */
export function formatMeasure(value: ReportCell | undefined, format?: MeasureFormat): string {
  if (value === null || value === undefined) return EMPTY_CELL;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return typeof value === 'string' ? value : EMPTY_CELL;

  const decimals = decimalsFor(format);
  switch (format?.kind) {
    case 'percent':
      return `${new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n)}%`;
    case 'currency':
      // No currency CODE here on purpose: the code is org configuration, and
      // ui-kit holds no org knowledge. A grouped number reads correctly in any
      // currency; the label beside it carries the unit.
      return new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n);
    case 'duration_minutes':
      return formatDurationMinutes(n);
    default:
      return new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n);
  }
}

const COMPACT_UNITS: readonly { readonly at: number; readonly suffix: string }[] = [
  { at: 1_000_000_000, suffix: 'B' },
  { at: 1_000_000, suffix: 'M' },
  { at: 1_000, suffix: 'k' },
];

/**
 * Short form for an axis tick, where horizontal room is the binding constraint.
 * Tooltips and tables always use the full `formatMeasure` — an abbreviation is
 * for scanning a scale, never for reading a value.
 */
export function formatCompact(value: ReportCell | undefined, format?: MeasureFormat): string {
  if (value === null || value === undefined) return EMPTY_CELL;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return formatMeasure(value, format);
  if (format?.kind === 'duration_minutes') return formatDurationMinutes(n);

  const abs = Math.abs(n);
  for (const unit of COMPACT_UNITS) {
    if (abs >= unit.at) {
      const scaled = n / unit.at;
      const decimals = Math.abs(scaled) < 10 ? 1 : 0;
      const body = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
      }).format(scaled);
      return format?.kind === 'percent' ? `${body}${unit.suffix}%` : `${body}${unit.suffix}`;
    }
  }
  return formatMeasure(n, format);
}

/** A dimension cell. Post-pivot these are already rendered display strings (see
 *  pivot.ts `displayLabel`), so this is mostly a null guard plus a length cap —
 *  dimension values are user data from the underlying tables, not spec text. */
export function formatDimension(value: ReportCell | undefined, maxLength = 120): string {
  if (value === null || value === undefined || value === '') return EMPTY_CELL;
  const text = typeof value === 'string' ? value : String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Axis-tick truncation. Long category names otherwise either collide or push
 *  the plot area to nothing. */
export function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, Math.max(1, maxLength - 1))}…` : label;
}

/** Percentage of a total, for pie/donut slice labels and stacked shares.
 *  Returns null when the total is 0 or unusable — "0%" and "—" are different
 *  statements and this must not conflate them. */
export function shareOf(value: ReportCell | undefined, total: number): number | null {
  if (value === null || value === undefined || typeof value !== 'number') return null;
  if (!Number.isFinite(total) || total === 0) return null;
  return (value / total) * 100;
}

export function formatShare(value: ReportCell | undefined, total: number): string {
  const pct = shareOf(value, total);
  return pct === null ? EMPTY_CELL : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

/** Elapsed query time for the frame's footer. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return EMPTY_CELL;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Numeric coercion for chart geometry. Returns null — NOT 0 — for a hole, so
 *  Recharts leaves a gap instead of drawing a point on the baseline. */
export function toPlotValue(cell: ReportCell | undefined): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'boolean') return cell ? 1 : 0;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}
