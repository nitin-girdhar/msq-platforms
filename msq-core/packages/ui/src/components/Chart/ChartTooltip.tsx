'use client';

// ── ChartTooltip ─────────────────────────────────────────────────────────────
// The hover layer is not optional. An SVG chart IS interactive, and the values
// a reader cannot get off the axis have to be gettable somewhere — which is
// doubly true here, where three light-mode palette slots are below 3:1 and lean
// on labels for relief.
//
// Recharts' default tooltip formats numbers with `String()` and orders entries
// by paint order. This one formats through the measure's own `MeasureFormat` and
// keeps the series order that `resolveSeries` fixed, so the tooltip reads in the
// same order as the legend and the stack.

import type { ReactNode } from 'react';

import { EMPTY_CELL, formatMeasure } from './format';
import { chartTheme, type ChartMode } from './palette';
import type { DrawnSeries } from './series';

/** The subset of Recharts' tooltip payload this component relies on. Typed
 *  locally rather than imported: Recharts' own props are `any`-ish across
 *  versions, and this keeps the contract explicit. */
export interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: unknown;
  name?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: unknown;
  payload?: readonly TooltipPayloadEntry[];
  /** Render order + colours + formats, from `resolveSeries`. */
  series: readonly DrawnSeries[];
  mode?: ChartMode;
  /** Header shown above the label, e.g. the x-axis field name. */
  labelPrefix?: string;
  /** Append each row's share of the hovered total. Right for a stack or a pie,
   *  meaningless for unrelated measures — hence opt-in. */
  showShare?: boolean;
}

export default function ChartTooltip({
  active = false,
  label,
  payload,
  series,
  mode = 'light',
  labelPrefix,
  showShare = false,
}: ChartTooltipProps): ReactNode {
  if (!active || payload === undefined || payload.length === 0) return null;

  const theme = chartTheme(mode);
  const byKey = new Map<string, TooltipPayloadEntry>();
  for (const entry of payload) {
    if (entry.dataKey !== undefined) byKey.set(String(entry.dataKey), entry);
  }

  // Series order, not paint order. A stack drawn bottom-up would otherwise read
  // upside down relative to its own legend.
  const rows = series
    .map((s) => ({ s, entry: byKey.get(s.dataKey) }))
    .filter((r): r is { s: DrawnSeries; entry: TooltipPayloadEntry } => r.entry !== undefined);

  if (rows.length === 0) return null;

  const total = rows.reduce((sum, r) => {
    const v = typeof r.entry.value === 'number' ? r.entry.value : 0;
    return sum + v;
  }, 0);

  return (
    <div
      className="pointer-events-none rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{
        borderColor: theme.tokens.grid,
        background: theme.tokens.surface,
        color: theme.tokens.text,
        // A 2px surface ring so the tooltip separates from a dense plot behind it.
        boxShadow: `0 0 0 2px ${theme.tokens.surface}, 0 8px 24px rgba(0,0,0,0.12)`,
      }}
    >
      {(labelPrefix !== undefined || label !== undefined) && (
        <div className="mb-1.5 font-semibold" style={{ color: theme.tokens.text }}>
          {labelPrefix !== undefined && (
            <span className="mr-1 font-normal" style={{ color: theme.tokens.textMuted }}>
              {labelPrefix}
            </span>
          )}
          {label === undefined || label === null || label === '' ? EMPTY_CELL : String(label)}
        </div>
      )}
      <table className="w-full border-separate" style={{ borderSpacing: '0 2px' }}>
        <tbody>
          {rows.map(({ s, entry }) => {
            const value = entry.value;
            const cell =
              value === null || value === undefined
                ? EMPTY_CELL
                : formatMeasure(
                    typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
                      ? value
                      : null,
                    s.measure.format,
                  );
            const share =
              showShare && typeof value === 'number' && total !== 0
                ? `${((value / total) * 100).toFixed(0)}%`
                : undefined;
            return (
              <tr key={s.dataKey}>
                <td className="pr-2 align-middle">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-sm align-middle"
                    style={{ background: s.color }}
                  />
                </td>
                <td className="max-w-[16rem] truncate pr-3" style={{ color: theme.tokens.textMuted }}>
                  {s.label}
                </td>
                {/* Values stay in text ink, never the series colour — the swatch
                    already carries identity. */}
                <td
                  className="text-right font-medium tabular-nums"
                  style={{ color: theme.tokens.text }}
                >
                  {cell}
                </td>
                {showShare && (
                  <td className="pl-2 text-right tabular-nums" style={{ color: theme.tokens.textMuted }}>
                    {share ?? ''}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
