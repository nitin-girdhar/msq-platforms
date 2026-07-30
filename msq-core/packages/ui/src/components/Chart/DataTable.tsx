'use client';

// ── DataTable ────────────────────────────────────────────────────────────────
// A plain semantic <table>, NOT AG Grid. The pivot output is small and already
// aggregated, so it needs no virtualisation, no column engine and no 300 kB of
// grid — and pulling AG Grid into ui-kit would add a dependency the kit does
// not currently have. (lms-web has AG Grid for its own lead lists; that is an
// app-level choice and stays there.)
//
// This is also the **relief channel** for the sub-3:1 light-mode palette slots
// and the chart-type `table`. Both jobs want the same thing: every number
// readable as text, with no colour in the reading path.
//
// Columns come from `result.columns` in the order the server described. Nothing
// here re-derives or re-sorts them.

import type { ReactNode } from 'react';

import type { ReportResult } from '@platform/reporting';

import { EMPTY_CELL, formatDimension, formatMeasure } from './format';
import { chartTheme, type ChartMode } from './palette';

export interface DataTableProps {
  result: ReportResult;
  mode?: ChartMode;
  /** Rows past this are not rendered; a footer says how many were hidden. The
   *  cap exists because a 5 000-group result freezes the tab, not because the
   *  data is uninteresting. */
  maxRows?: number;
  /** Show the server's grand-total row. Absent totals stay absent — a wrong
   *  total is worse than no total (count_distinct is deliberately excluded
   *  server-side). */
  showTotals?: boolean;
  caption?: string;
  onRowClick?: (rowIndex: number) => void;
  className?: string;
}

const DEFAULT_MAX_ROWS = 500;

export default function DataTable({
  result,
  mode = 'light',
  maxRows = DEFAULT_MAX_ROWS,
  showTotals = true,
  caption,
  onRowClick,
  className,
}: DataTableProps): ReactNode {
  const theme = chartTheme(mode);
  const formatByMeasureId = new Map(result.spec.measures.map((m) => [m.id, m.format]));
  const visible = result.rows.slice(0, Math.max(0, maxRows));
  const hiddenCount = result.rows.length - visible.length;
  const totals = showTotals ? result.grandTotals : undefined;

  return (
    <div className={`w-full overflow-x-auto ${className ?? ''}`}>
      <table className="w-full border-collapse text-left text-xs">
        {caption !== undefined && (
          <caption className="pb-2 text-left text-xs" style={{ color: theme.tokens.textMuted }}>
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {result.columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`whitespace-nowrap border-b px-2.5 py-2 font-semibold ${
                  col.role === 'measure' ? 'text-right' : 'text-left'
                }`}
                style={{ borderColor: theme.tokens.grid, color: theme.tokens.textMuted }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td
                colSpan={Math.max(1, result.columns.length)}
                className="px-2.5 py-6 text-center"
                style={{ color: theme.tokens.textMuted }}
              >
                No rows.
              </td>
            </tr>
          )}
          {visible.map((row, rowIndex) => (
            <tr
              // Row identity is positional: two groups can legitimately share
              // every rendered dimension label (different underlying ids), so a
              // value-derived key would collide.
              key={rowIndex}
              className={onRowClick === undefined ? undefined : 'cursor-pointer'}
              onClick={onRowClick === undefined ? undefined : () => onRowClick(rowIndex)}
            >
              {result.columns.map((col) => {
                const cell = row[col.key];
                const isMeasure = col.role === 'measure';
                return (
                  <td
                    key={col.key}
                    className={`border-b px-2.5 py-1.5 ${
                      isMeasure ? 'text-right tabular-nums' : 'text-left'
                    }`}
                    style={{
                      borderColor: theme.tokens.grid,
                      // A hole stays visibly a hole, in muted ink, never a zero.
                      color:
                        cell === null || cell === undefined ? theme.tokens.textMuted : theme.tokens.text,
                    }}
                  >
                    {isMeasure
                      ? formatMeasure(
                          cell,
                          col.measureId === undefined ? undefined : formatByMeasureId.get(col.measureId),
                        )
                      : formatDimension(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {totals !== undefined && visible.length > 0 && (
          <tfoot>
            <tr>
              {result.columns.map((col, i) => {
                if (col.role === 'dimension') {
                  return (
                    <th
                      key={col.key}
                      scope="row"
                      className="px-2.5 py-2 text-left font-semibold"
                      style={{ color: theme.tokens.textMuted }}
                    >
                      {i === 0 ? 'Total' : ''}
                    </th>
                  );
                }
                const value = totals[col.key];
                return (
                  <td
                    key={col.key}
                    className="px-2.5 py-2 text-right font-semibold tabular-nums"
                    style={{ color: value === null || value === undefined ? theme.tokens.textMuted : theme.tokens.text }}
                    // An absent total is a real statement ("not summable"), so
                    // spell it out rather than leaving a bare dash to guess at.
                    title={
                      value === null || value === undefined
                        ? 'Not summable across groups — an average or a distinct count has no meaningful total here.'
                        : undefined
                    }
                  >
                    {value === null || value === undefined
                      ? EMPTY_CELL
                      : formatMeasure(
                          value,
                          col.measureId === undefined ? undefined : formatByMeasureId.get(col.measureId),
                        )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
      {hiddenCount > 0 && (
        <p className="px-2.5 pt-2 text-[11px]" style={{ color: theme.tokens.textMuted }}>
          Showing the first {visible.length.toLocaleString()} of {result.rows.length.toLocaleString()}{' '}
          rows.
        </p>
      )}
    </div>
  );
}
