'use client';

// ── ChartLegend ──────────────────────────────────────────────────────────────
// Present whenever there are ≥2 series, absent at 1 (the title already names
// it). This is the accessibility guarantee that identity is never carried by
// colour alone; it pairs with the direct labels and the table view.
//
// Rendered outside Recharts' <Legend> so it can wrap, truncate and sit above
// the plot without stealing plot height on every resize.

import type { ReactNode } from 'react';

import { chartTheme, type ChartMode } from './palette';
import type { DrawnSeries } from './series';

export interface ChartLegendProps {
  series: readonly DrawnSeries[];
  mode?: ChartMode;
  /** Clicking an entry toggles it. Omit for a static legend. */
  onToggle?: (dataKey: string) => void;
  /** Keys currently hidden. Only meaningful with `onToggle`. */
  hidden?: ReadonlySet<string>;
  className?: string;
}

export default function ChartLegend({
  series,
  mode = 'light',
  onToggle,
  hidden,
  className,
}: ChartLegendProps): ReactNode {
  if (series.length === 0) return null;
  const theme = chartTheme(mode);

  return (
    <ul
      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className ?? ''}`}
      style={{ color: theme.tokens.textMuted }}
    >
      {series.map((s) => {
        const isHidden = hidden?.has(s.dataKey) === true;
        const content = (
          <>
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                background: s.color,
                // A 2px surface ring keeps adjacent swatches from fusing into
                // one block of colour in a dense legend.
                boxShadow: `0 0 0 2px ${theme.tokens.surface}`,
                opacity: isHidden ? 0.35 : 1,
              }}
            />
            {/* Label wears text ink, not the series colour. */}
            <span
              className="max-w-[14rem] truncate text-xs"
              style={{
                color: theme.tokens.textMuted,
                textDecoration: isHidden ? 'line-through' : 'none',
                opacity: isHidden ? 0.6 : 1,
              }}
            >
              {s.label}
            </span>
          </>
        );

        return (
          <li key={s.dataKey}>
            {onToggle === undefined ? (
              <span className="flex items-center gap-1.5">{content}</span>
            ) : (
              <button
                type="button"
                // Hit target is comfortably larger than the 10px swatch.
                className="flex items-center gap-1.5 py-1"
                onClick={() => onToggle(s.dataKey)}
                aria-pressed={!isHidden}
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
