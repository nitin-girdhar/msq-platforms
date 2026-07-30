'use client';

// ── KpiTile ──────────────────────────────────────────────────────────────────
// The "not a chart" answer. When the data's job is a single headline, a bar of
// one bar is worse than the number itself.
//
// The delta rule: a status colour never carries meaning alone, so the direction
// is always ALSO an arrow glyph and a word in the accessible label. A red
// number with no arrow is unreadable to a third of readers and to anyone in
// forced-colors mode.
//
// The figure uses default proportional figures (not tabular), per the type
// spec — tabular-nums is for columns that must align vertically, which a
// standalone hero number is not.

import type { ReactNode } from 'react';

import type { MeasureFormat, ReportCell } from '@platform/reporting';

import { EMPTY_CELL, formatMeasure } from './format';
import { chartTheme, deltaColor, type ChartMode } from './palette';
import Sparkline from './Sparkline';

export interface KpiTileProps {
  label: string;
  value: ReportCell | undefined;
  format?: MeasureFormat;
  /** Signed change vs the comparison period, in the value's own units. */
  delta?: number | undefined;
  /** Percentage change. Rendered instead of `delta` when both are present. */
  deltaPercent?: number | undefined;
  /** What the delta is measured against, e.g. "vs previous 30 days". */
  deltaLabel?: string;
  /** For a metric where down is good (cost, time-to-close), so the status
   *  colour and the word match the reading rather than the sign. */
  invertDelta?: boolean;
  trend?: readonly (number | null)[];
  mode?: ChartMode;
  onClick?: () => void;
  className?: string;
}

export default function KpiTile({
  label,
  value,
  format,
  delta,
  deltaPercent,
  deltaLabel,
  invertDelta = false,
  trend,
  mode = 'light',
  onClick,
  className,
}: KpiTileProps): ReactNode {
  const theme = chartTheme(mode);
  const shown = delta ?? deltaPercent;
  const hasDelta = shown !== undefined && Number.isFinite(shown);
  // Direction is what the reader sees; goodness is what the colour says. For an
  // inverted metric they point opposite ways, which is exactly the point.
  const direction = hasDelta ? Math.sign(shown) : 0;
  const goodness = invertDelta ? -direction : direction;
  const arrow = direction > 0 ? '▲' : direction < 0 ? '▼' : '■';
  const word = direction > 0 ? 'up' : direction < 0 ? 'down' : 'unchanged';

  const deltaText = ((): string => {
    if (!hasDelta) return '';
    const magnitude =
      deltaPercent !== undefined && delta === undefined
        ? `${Math.abs(deltaPercent).toFixed(1)}%`
        : formatMeasure(Math.abs(shown), format);
    return `${arrow} ${magnitude}`;
  })();

  const Wrapper = onClick === undefined ? 'div' : 'button';

  return (
    <Wrapper
      type={onClick === undefined ? undefined : 'button'}
      onClick={onClick}
      className={`flex w-full flex-col gap-1 rounded-xl border p-4 text-left ${className ?? ''}`}
      style={{
        borderColor: theme.tokens.grid,
        background: theme.tokens.surface,
        color: theme.tokens.text,
      }}
    >
      <span className="truncate text-xs font-medium" style={{ color: theme.tokens.textMuted }}>
        {label}
      </span>

      <span
        className="text-3xl font-semibold leading-tight"
        style={{ color: theme.tokens.text }}
        title={value === null || value === undefined ? 'No value' : undefined}
      >
        {value === null || value === undefined ? EMPTY_CELL : formatMeasure(value, format)}
      </span>

      {(hasDelta || trend !== undefined) && (
        <span className="mt-1 flex items-center justify-between gap-3">
          {hasDelta && (
            <span
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: deltaColor(goodness, mode) }}
            >
              <span aria-hidden="true">{deltaText}</span>
              {/* The direction in words, for anyone who cannot use the colour
                  or the glyph. */}
              <span className="sr-only">
                {word}
                {deltaText === '' ? '' : ` ${deltaText.replace(/^[▲▼■]\s*/u, '')}`}
                {deltaLabel === undefined ? '' : ` ${deltaLabel}`}
              </span>
              {deltaLabel !== undefined && (
                <span aria-hidden="true" className="font-normal" style={{ color: theme.tokens.textMuted }}>
                  {deltaLabel}
                </span>
              )}
            </span>
          )}
          {trend !== undefined && (
            <Sparkline
              values={trend}
              mode={mode}
              {...(hasDelta ? { color: deltaColor(goodness, mode) } : {})}
              className="shrink-0"
            />
          )}
        </span>
      )}
    </Wrapper>
  );
}
