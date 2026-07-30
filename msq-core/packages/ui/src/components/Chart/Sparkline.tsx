'use client';

// ── Sparkline ────────────────────────────────────────────────────────────────
// A trend shape inside a KPI tile — no axes, no grid, no legend, no tooltip.
// It answers "which way, roughly how much", and nothing else; anything needing
// a value belongs in a real chart.
//
// Deliberately hand-drawn SVG rather than a Recharts <LineChart>: at ~64×20 the
// Recharts machinery (ResponsiveContainer, axis calculation, its own tooltip
// layer) costs more than the whole mark, and a sparkline has no interaction to
// justify it.
//
// Nulls break the path. A gap in the data must read as a gap, not as a dip to
// zero and not as a straight line across the hole.

import { useId, type ReactNode } from 'react';

import { chartTheme, type ChartMode } from './palette';

export interface SparklineProps {
  /** In order. `null` is a hole and breaks the line. */
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  /** Fill the area under the line. Reads as volume; off by default. */
  filled?: boolean;
  mode?: ChartMode;
  /** Screen-reader text. Without it the sparkline is decorative and is hidden
   *  from assistive tech — which is correct when the tile's own value and delta
   *  already say everything. */
  label?: string;
  className?: string;
}

interface Point {
  x: number;
  y: number;
}

export default function Sparkline({
  values,
  width = 96,
  height = 28,
  color,
  filled = false,
  mode = 'light',
  label,
  className,
}: SparklineProps): ReactNode {
  const theme = chartTheme(mode);
  const stroke = color ?? theme.palette.categorical[0] ?? theme.tokens.text;
  const gradientId = useId();

  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length < 2) return null;

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  // A flat series would divide by zero; centre it instead of collapsing to the
  // top edge, which would read as "at maximum".
  const span = max - min === 0 ? 1 : max - min;
  const pad = 2;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;

  // Split into contiguous runs so a null leaves an actual gap.
  const runs: Point[][] = [];
  let current: Point[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    const yFrac = (v - min) / span;
    current.push({
      x: pad + i * stepX,
      y: height - pad - yFrac * (height - pad * 2),
    });
  });
  if (current.length > 0) runs.push(current);

  const pathOf = (pts: readonly Point[]): string =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  const last = runs[runs.length - 1]?.[(runs[runs.length - 1]?.length ?? 1) - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role={label === undefined ? 'presentation' : 'img'}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      overflow="visible"
    >
      {filled && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}
      {filled &&
        runs
          .filter((r) => r.length >= 2)
          .map((pts, i) => (
            <path
              key={`fill-${i}`}
              d={`${pathOf(pts)} L${(pts[pts.length - 1]?.x ?? 0).toFixed(2)},${height - pad} L${(
                pts[0]?.x ?? 0
              ).toFixed(2)},${height - pad} Z`}
              fill={`url(#${gradientId})`}
              stroke="none"
            />
          ))}
      {runs
        .filter((r) => r.length >= 2)
        .map((pts, i) => (
          <path
            key={`line-${i}`}
            d={pathOf(pts)}
            fill="none"
            stroke={stroke}
            // 2px line, per the mark spec — thin enough to stay a trace.
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      {/* A single isolated point would otherwise be invisible (a path of one
          point draws nothing). */}
      {runs
        .filter((r) => r.length === 1)
        .map((pts, i) => (
          <circle key={`dot-${i}`} cx={pts[0]?.x} cy={pts[0]?.y} r={2} fill={stroke} />
        ))}
      {last !== undefined && (
        <circle
          cx={last.x}
          cy={last.y}
          r={2.5}
          fill={stroke}
          // 2px surface ring so the end cap separates from the line behind it.
          stroke={theme.tokens.surface}
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
