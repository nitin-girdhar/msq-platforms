'use client';

// ── ChartFrame ───────────────────────────────────────────────────────────────
// The card every chart lives in, and the owner of every non-chart state:
// loading, error, empty, truncated, too-many-series.
//
// It also owns the **contrast relief channel**. Three light-mode categorical
// slots sit below 3:1 on white (see palette.ts § RELIEF); the dataviz skill's
// contrast WARN is not dismissable — it obligates visible labels or a table
// view. The Chart/Table toggle here IS that table view, which is why it is
// built into the frame rather than left to each consumer to remember.
//
// Truncation gets a banner, not a footnote. `meta.truncated` means rows were
// dropped: a chart that looks complete while missing its tail is worse than no
// chart at all, so the banner sits above the plot where it cannot be missed.

import { useId, useState, type ReactNode } from 'react';

import type { ReportResult } from '@platform/reporting';

import { formatElapsed } from './format';
import { CATEGORICAL_SLOTS, chartTheme, exceedsSlots, type ChartMode } from './palette';

export interface ChartFrameProps {
  title?: string;
  subtitle?: string;
  /** Rendered when a result is present and not empty. */
  children: ReactNode;
  /** The table view behind the toggle. Omit to hide the toggle entirely — only
   *  correct for a form that has no tabular reading (a bare sparkline). */
  tableView?: ReactNode;
  result?: ReportResult | undefined;
  loading?: boolean;
  error?: string | undefined;
  /** True when there is nothing to draw. The frame cannot always tell: a KPI
   *  with one zero row is empty to a bar chart and meaningful to a tile. */
  empty?: boolean;
  emptyMessage?: string;
  height?: number;
  mode?: ChartMode;
  /** Extra controls in the header (an export button, a chart-type picker). */
  actions?: ReactNode;
  className?: string;
}

const DEFAULT_HEIGHT = 320;

function Banner({
  tone,
  children,
  mode,
}: {
  tone: 'warning' | 'error';
  children: ReactNode;
  mode: ChartMode;
}): ReactNode {
  const theme = chartTheme(mode);
  const isError = tone === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed"
      style={{
        borderColor: isError ? theme.tokens.negative : theme.tokens.axis,
        color: isError ? theme.tokens.negative : theme.tokens.textMuted,
        background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.03)',
      }}
    >
      {/* The glyph is the secondary channel — the banner never relies on its
          border colour alone to say "this is a problem". */}
      <span aria-hidden="true" className="font-semibold">
        {isError ? '!' : 'i'}
      </span>
      <span>{children}</span>
    </div>
  );
}

export default function ChartFrame({
  title,
  subtitle,
  children,
  tableView,
  result,
  loading = false,
  error,
  empty = false,
  emptyMessage = 'No data for these filters.',
  height = DEFAULT_HEIGHT,
  mode = 'light',
  actions,
  className,
}: ChartFrameProps): ReactNode {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const theme = chartTheme(mode);
  const panelId = useId();

  const meta = result?.meta;
  const tooManySeries = result !== undefined && exceedsSlots(result);

  const body = ((): ReactNode => {
    if (loading) {
      return (
        <div
          className="flex items-center justify-center text-sm"
          style={{ height, color: theme.tokens.textMuted }}
          role="status"
          aria-live="polite"
        >
          Running report…
        </div>
      );
    }
    if (error !== undefined) {
      return (
        <div
          className="flex items-center justify-center px-6 text-center text-sm"
          style={{ height, color: theme.tokens.negative }}
          role="alert"
        >
          {error}
        </div>
      );
    }
    if (empty) {
      return (
        <div
          className="flex items-center justify-center px-6 text-center text-sm"
          style={{ height, color: theme.tokens.textMuted }}
        >
          {emptyMessage}
        </div>
      );
    }
    if (view === 'table' && tableView !== undefined) return tableView;
    return children;
  })();

  const showToggle = tableView !== undefined && !loading && error === undefined && !empty;

  return (
    <section
      className={`rounded-xl border p-4 ${className ?? ''}`}
      style={{
        borderColor: theme.tokens.grid,
        background: theme.tokens.surface,
        color: theme.tokens.text,
      }}
    >
      {(title !== undefined || subtitle !== undefined || actions !== undefined || showToggle) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title !== undefined && (
              <h3 className="truncate text-sm font-semibold" style={{ color: theme.tokens.text }}>
                {title}
              </h3>
            )}
            {subtitle !== undefined && (
              <p className="mt-0.5 truncate text-xs" style={{ color: theme.tokens.textMuted }}>
                {subtitle}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {showToggle && (
              <div
                className="inline-flex overflow-hidden rounded-md border text-xs"
                style={{ borderColor: theme.tokens.grid }}
                role="group"
                aria-label="Chart or table view"
              >
                {(['chart', 'table'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    aria-controls={panelId}
                    className="px-2.5 py-1 font-medium capitalize"
                    style={
                      view === v
                        ? { background: theme.tokens.text, color: theme.tokens.surface }
                        : { color: theme.tokens.textMuted }
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>
      )}

      {meta?.truncated === true && (
        <Banner tone="warning" mode={mode}>
          <strong>Showing a partial result.</strong> This report hit the row cap, so groups beyond{' '}
          {meta.rowCount.toLocaleString()} were dropped — totals and any &ldquo;largest&rdquo;
          reading are understated. Narrow the filters or add a Top N to see a complete picture.
        </Banner>
      )}

      {tooManySeries && (
        <Banner tone="warning" mode={mode}>
          This report draws more than {CATEGORICAL_SLOTS} series, so colours repeat and two
          different series can share a hue. Fold the tail into &ldquo;Other&rdquo;, or split the
          report, before reading it.
        </Banner>
      )}

      <div id={panelId}>{body}</div>

      {meta !== undefined && !loading && error === undefined && (
        <footer
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
          style={{ color: theme.tokens.textMuted }}
        >
          <span>
            {meta.rowCount.toLocaleString()} {meta.rowCount === 1 ? 'group' : 'groups'}
          </span>
          <span aria-hidden="true">·</span>
          {/* appliedScope is echoed so a user can explain why their number
              differs from a colleague's — that is the whole reason the server
              returns it. */}
          <span>scope: {meta.appliedScope}</span>
          <span aria-hidden="true">·</span>
          <span>{meta.timezone}</span>
          <span aria-hidden="true">·</span>
          <span>{formatElapsed(meta.elapsedMs)}</span>
        </footer>
      )}
    </section>
  );
}
