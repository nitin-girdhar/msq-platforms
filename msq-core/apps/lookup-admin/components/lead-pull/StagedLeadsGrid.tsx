'use client';

import '@platform/ui-kit/ag-grid.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, FirstDataRenderedEvent, GridApi, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { GRID_DEFAULT_COL_DEF, scalePx } from '@platform/ui-kit/grid';
import { Modal, Button, buildFilename, exportRows } from '@platform/ui-kit';
import {
  leadPull,
  IMPORTABLE_PULL_VERDICTS,
  type PullVerdict,
  type StagedLeadRow,
} from '@/src/lib/api/client';
import {
  APPLIED_STATUS_CLASSES,
  APPLIED_STATUS_LABELS,
  VERDICT_CLASSES,
  VERDICT_LABELS,
  type AppliedStatus,
} from '@/components/meta-shared/pull-labels';

ModuleRegistry.registerModules([AllCommunityModule]);

const PAGE_SIZE = 200;

function badge(label: string, cls: string) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

interface Props {
  tenantId: string;
  runId: string;
  // undefined = every staged row for this run.
  verdict: PullVerdict | undefined;
  // Narrow to one Apply outcome (the summary's applied / skipped / failed numbers).
  // Applied in SQL, so it is correct on a run bigger than one loaded page.
  appliedStatus?: AppliedStatus | undefined;
  title: string;
  pageNames: Record<string, string>;
  // 1.51.0: branch names for the Branch column (org_id -> name).
  orgNames?: Record<string, string> | undefined;
  // 1.70.0: only a finished run (completed, or applied with leftovers) can be re-ticked.
  canSelect?: boolean | undefined;
  // Called after a tick / untick is saved, so the page can refresh Apply's count.
  onSelectionChanged?: (() => void) | undefined;
  onClose: () => void;
}

export default function StagedLeadsGrid({ tenantId, runId, verdict, appliedStatus, title, pageNames, orgNames, canSelect, onSelectionChanged, onClose }: Props) {
  const [rows, setRows] = useState<StagedLeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Only the newest request may write state: changing the view (or pressing
  // "Load more" twice) leaves older requests in flight, and a slow stale answer
  // must not replace the rows now on screen.
  const loadSeq = useRef(0);
  const loadPage = useCallback((p: number, append: boolean) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    leadPull.listLeads(tenantId, runId, verdict, p, PAGE_SIZE, appliedStatus)
      .then((res) => {
        if (seq !== loadSeq.current) return;
        setRows((prev) => (append ? [...prev, ...res.data] : res.data));
        setTotal(res.total);
        setPage(p);
      })
      .catch((err: unknown) => {
        if (seq !== loadSeq.current) return;
        setError(err instanceof Error ? err.message : 'Could not load staged leads.');
      })
      .finally(() => { if (seq === loadSeq.current) setLoading(false); });
  }, [tenantId, runId, verdict, appliedStatus]);

  useEffect(() => {
    loadPage(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, runId, verdict, appliedStatus]);

  // A column filter or sort only sees the rows loaded so far. On a partial load it
  // would present a slice of the run as the whole answer, so they switch off until
  // everything is in (the verdict / outcome filters above are server-side and exact).
  const partial = rows.length < total;

  const isTickable = (r: StagedLeadRow | undefined): boolean =>
    !!r && !!canSelect && r.applied_status === 'pending' && !!r.verdict && IMPORTABLE_PULL_VERDICTS.includes(r.verdict);

  // Saves ONE row's tick, optimistically; a failure puts it back and says so.
  const toggleRow = useCallback((row: StagedLeadRow, selected: boolean) => {
    setError(null);
    const previous = row.apply_selected;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, apply_selected: selected } : r)));
    leadPull.setSelection(tenantId, runId, { selected, ids: [row.id] })
      .then(() => onSelectionChanged?.())
      .catch((err: unknown) => {
        // Revert only if the row still shows THIS request's value: a later toggle of the
        // same row (rapid clicks) must not be overwritten by an earlier request's failure.
        setRows((prev) => prev.map((r) => (r.id === row.id && r.apply_selected === selected ? { ...r, apply_selected: previous } : r)));
        setError(err instanceof Error ? err.message : 'Could not save the selection.');
      });
  }, [tenantId, runId, onSelectionChanged]);

  // Select all / none for everything this view covers (the verdict filter, all pages).
  const setAll = (selected: boolean) => {
    setSaving(true);
    setError(null);
    leadPull.setSelection(tenantId, runId, { selected, ...(verdict ? { verdict } : {}) })
      .then(() => {
        setRows((prev) => prev.map((r) => (isTickable(r) ? { ...r, apply_selected: selected } : r)));
        onSelectionChanged?.();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not save the selection.'))
      .finally(() => setSaving(false));
  };

  // Every staged row of this view (not just the loaded page). Contact details are not part of
  // the staged list on purpose, so the file carries ids, form, branch and verdict only.
  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const all: StagedLeadRow[] = [];
      for (let p = 1; p <= 200; p += 1) {
        const res = await leadPull.listLeads(tenantId, runId, verdict, p, 500, appliedStatus);
        all.push(...res.data);
        if (all.length >= res.total || res.data.length === 0) break;
      }
      exportRows(
        all,
        [
          { header: 'Lead created', value: (r: StagedLeadRow) => r.lead_created_at },
          { header: 'Meta lead ID', value: (r) => r.meta_lead_id },
          { header: 'Page', value: (r) => pageNames[r.page_id] ?? r.page_id },
          { header: 'Form', value: (r) => r.form_name ?? r.form_id },
          { header: 'Branch', value: (r) => (r.org_id ? orgNames?.[r.org_id] ?? r.org_id : 'Unmapped') },
          { header: 'Routes to (type)', value: (r) => r.suggested_campaign_type_label },
          { header: 'Verdict', value: (r) => (r.verdict ? VERDICT_LABELS[r.verdict] ?? r.verdict : '') },
          { header: 'Reason', value: (r) => r.reason },
          { header: 'Will be applied', value: (r) => (r.apply_selected ? 'yes' : 'no') },
          { header: 'Applied status', value: (r) => r.applied_status },
          { header: 'Applied error', value: (r) => r.applied_error },
        ],
        buildFilename(['staged-leads', verdict ?? 'all', appliedStatus ?? '']),
        'csv',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export the staged leads.');
    } finally {
      setExporting(false);
    }
  };

  const tickCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const row = p.data;
    if (!row) return null;
    if (!isTickable(row)) return <span className="text-on-surface-variant">—</span>;
    return (
      <input
        type="checkbox"
        checked={row.apply_selected}
        onChange={(e) => toggleRow(row, e.target.checked)}
        aria-label={`Apply lead ${row.meta_lead_id}`}
        className="accent-primary"
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSelect, toggleRow]);

  const pageCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const id = p.data?.page_id ?? '';
    const name = pageNames[id];
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm text-on-surface">{name ?? id}</p>
        {name ? <p className="truncate font-mono text-[0.6875rem] leading-tight text-on-surface-variant">{id}</p> : null}
      </div>
    );
  }, [pageNames]);

  const verdictCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const v = p.data?.verdict;
    if (!v) return null;
    return badge(VERDICT_LABELS[v] ?? v, VERDICT_CLASSES[v] ?? 'bg-surface-container text-on-surface-variant');
  }, []);

  const hiringCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    if (!p.data?.is_hiring_form) return null;
    return (
      <span
        className="inline-flex items-center rounded-full bg-status-info-container px-2 py-0.5 text-xs font-medium text-primary"
        title="The form name looks like recruitment. Check the Routes to column: if it is not your hiring type, add a form-name rule or set the page/form default type."
      >
        Hiring-looking form
      </span>
    );
  }, []);

  const appliedStatusCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const s = p.data?.applied_status;
    if (!s) return null;
    return badge(APPLIED_STATUS_LABELS[s] ?? s, APPLIED_STATUS_CLASSES[s] ?? 'bg-surface-container text-on-surface-variant');
  }, []);

  const importableCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const v = p.data?.verdict;
    if (!v || !IMPORTABLE_PULL_VERDICTS.includes(v)) return <span className="text-on-surface-variant">—</span>;
    return <span className="text-on-status-success-container">✓</span>;
  }, []);

  const columnDefs = useMemo((): ColDef<StagedLeadRow>[] => [
    {
      // 1.70.0: whether Apply will import this row. Only importable, still-pending rows can be ticked.
      colId: 'apply', headerName: 'Apply', width: 90, sortable: true, filter: false,
      valueGetter: (p) => (p.data?.apply_selected ? 'Yes' : 'No'),
      cellRenderer: tickCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
    },
    {
      colId: 'lead_created_at', headerName: 'Lead created', width: 170, sortable: true, filter: true,
      valueGetter: (p) => formatDate(p.data?.lead_created_at ?? null),
    },
    {
      colId: 'page', headerName: 'Page', width: 200, sortable: true, filter: true,
      valueGetter: (p) => {
        const id = p.data?.page_id ?? '';
        const name = pageNames[id];
        return name ? `${name} (${id})` : id;
      },
      cellRenderer: pageCellRenderer,
    },
    {
      colId: 'form', headerName: 'Form', width: 180, minWidth: 140, sortable: true, filter: true,
      valueGetter: (p) => p.data?.form_name ?? p.data?.form_id ?? '',
    },
    {
      // 1.51.0: where Apply will put the lead — the branch from the page/form
      // mapping, and the type (therefore the department's pool) by the same
      // ladder the webhook uses: confirmed campaign -> rules -> page default ->
      // tenant default.
      colId: 'branch', headerName: 'Branch', width: 170, minWidth: 130, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.org_id ? orgNames?.[p.data.org_id] ?? p.data.org_id : 'Unmapped'),
    },
    {
      colId: 'routes_to', headerName: 'Routes to (type)', width: 150, minWidth: 120, sortable: true, filter: true,
      valueGetter: (p) => p.data?.suggested_campaign_type_label ?? '—',
    },
    {
      colId: 'verdict', headerName: 'Verdict', width: 160, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.verdict ? VERDICT_LABELS[p.data.verdict] ?? p.data.verdict : ''),
      cellRenderer: verdictCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'importable', headerName: 'Importable', width: 110, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.verdict && IMPORTABLE_PULL_VERDICTS.includes(p.data.verdict) ? 'Yes' : 'No'),
      cellRenderer: importableCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
    },
    {
      colId: 'hiring', headerName: 'Hiring signal', width: 220, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.is_hiring_form ? 'Hiring-looking form' : ''),
      cellRenderer: hiringCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'reason', headerName: 'Reason', width: 260, minWidth: 180, sortable: true, filter: true,
      valueGetter: (p) => p.data?.reason ?? '',
    },
    {
      colId: 'applied_status', headerName: 'Applied status', width: 140, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.applied_status ? APPLIED_STATUS_LABELS[p.data.applied_status] ?? p.data.applied_status : ''),
      cellRenderer: appliedStatusCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'applied_error', headerName: 'Applied error', width: 260, minWidth: 180, sortable: true, filter: true,
      valueGetter: (p) => p.data?.applied_error ?? '',
    },
  ], [pageNames, orgNames, tickCellRenderer, pageCellRenderer, verdictCellRenderer, importableCellRenderer, hiringCellRenderer, appliedStatusCellRenderer]);

  // Column sizing inside a modal. The grid mounts while the modal is still laying out, so a fit run at that instant
  // measured a stale (narrow) width -- headers and filter icons piled on top of each other until the window was resized
  // (alt-tab did it). The fit is therefore deferred a frame, repeated when the first rows land, and only applied when the
  // columns genuinely fit: below their combined width they keep their own sizes and the grid scrolls sideways, instead
  // of every column being crushed under its minimum.
  const gridBox = useRef<HTMLDivElement>(null);
  const fitWhenRoomy = useCallback((api: GridApi<StagedLeadRow>, available: number) => {
    const needed = api.getColumns()?.reduce((n, c) => n + (c.getColDef().width ?? 150), 0) ?? 0;
    if (available >= needed) api.sizeColumnsToFit();
  }, []);
  const onGridReady = useCallback((params: GridReadyEvent<StagedLeadRow>) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (params.api.isDestroyed()) return;
      fitWhenRoomy(params.api, gridBox.current?.clientWidth ?? 0);
    }));
  }, [fitWhenRoomy]);
  const onFirstDataRendered = useCallback((params: FirstDataRenderedEvent<StagedLeadRow>) => {
    fitWhenRoomy(params.api, gridBox.current?.clientWidth ?? 0);
  }, [fitWhenRoomy]);
  const onGridSizeChanged = useCallback((params: GridSizeChangedEvent<StagedLeadRow>) => {
    fitWhenRoomy(params.api, params.clientWidth);
  }, [fitWhenRoomy]);

  // Stable module-level reference — never wrapped in useMemo.
  const defaultColDef: ColDef = GRID_DEFAULT_COL_DEF;

  const hasMore = rows.length < total;

  // See `partial` above: sorting / filtering a partial slice would misreport the run.
  const gridColumnDefs = useMemo<ColDef<StagedLeadRow>[]>(
    () => (partial ? columnDefs.map((c) => ({ ...c, filter: false, sortable: false })) : columnDefs),
    [columnDefs, partial],
  );

  return (
    <Modal open onClose={onClose} title={title} closeOnBackdropClick maxWidth="max-w-7xl">
      <div className="space-y-3">
        {error && (
          <div role="alert" className="rounded-xl border border-error/30 bg-error-container px-3 py-2 text-xs text-on-error-container">
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-on-surface-variant">
            {total.toLocaleString()} row{total === 1 ? '' : 's'}{rows.length < total ? ` — showing ${rows.length.toLocaleString()}` : ''}
            {canSelect ? ' · tick the rows Apply should import' : ''}
          </p>
          <div className="flex gap-2">
            {canSelect && (
              <>
                <Button size="sm" onClick={() => setAll(true)} disabled={saving}>Select all importable</Button>
                <Button size="sm" onClick={() => setAll(false)} disabled={saving}>Select none</Button>
              </>
            )}
            <Button size="sm" onClick={() => void handleExport()} disabled={exporting || total === 0} aria-busy={exporting}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          <div ref={gridBox} className="ag-theme-alpine" style={{ height: 480, width: '100%' }}>
            <AgGridReact<StagedLeadRow>
              rowData={rows}
              columnDefs={gridColumnDefs}
              defaultColDef={defaultColDef}
              rowHeight={scalePx(44)}
              headerHeight={scalePx(40)}
              animateRows={false}
              suppressCellFocus={false}
              enableCellTextSelection
              onGridReady={onGridReady}
              onFirstDataRendered={onFirstDataRendered}
              onGridSizeChanged={onGridSizeChanged}
              getRowId={(params) => params.data.id}
              overlayNoRowsTemplate={loading ? 'Loading…' : 'No staged leads for this filter.'}
            />
          </div>
        </div>
        {hasMore && (
          <p className="text-center text-xs text-on-surface-variant">
            Showing {rows.length.toLocaleString()} of {total.toLocaleString()} — sorting and column filters turn on once all rows are loaded.
          </p>
        )}
        {hasMore && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={() => loadPage(page + 1, true)} disabled={loading}>
              {loading ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, total - rows.length)} more`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
