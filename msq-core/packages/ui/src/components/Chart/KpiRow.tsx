'use client';

// ── KpiRow ───────────────────────────────────────────────────────────────────
// The `kpi` chart type: one tile per measure, no breakdown (CHART_SHAPE_RULES
// pins kpi to 0 row dims and 0 column dims, so the result is a single row).
//
// It reads that single row rather than the grand totals, because a kpi spec has
// no grouping — the row IS the total, and `grandTotals` is undefined for
// avg/min/max anyway.

import type { ReactNode } from 'react';

import { cellKey, measureLabel, type ReportResult } from '@platform/reporting';

import KpiTile from './KpiTile';
import type { ChartMode } from './palette';

export interface KpiRowProps {
  result: ReportResult;
  mode?: ChartMode;
  onTileClick?: (measureId: string) => void;
  className?: string;
}

export default function KpiRow({ result, mode = 'light', onTileClick, className }: KpiRowProps): ReactNode {
  const row = result.rows[0];

  return (
    <div
      className={`grid gap-3 ${
        result.spec.measures.length >= 3
          ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
          : 'grid-cols-1 sm:grid-cols-2'
      } ${className ?? ''}`}
    >
      {result.spec.measures.map((measure) => (
        <KpiTile
          key={measure.id}
          label={measureLabel(measure)}
          // No row at all ⇒ undefined ⇒ the tile renders an em dash. An empty
          // result is not a zero.
          value={row?.[cellKey(measure.id)]}
          {...(measure.format === undefined ? {} : { format: measure.format })}
          mode={mode}
          {...(onTileClick === undefined ? {} : { onClick: () => onTileClick(measure.id) })}
        />
      ))}
    </div>
  );
}
