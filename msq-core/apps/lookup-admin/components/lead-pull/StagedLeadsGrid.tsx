'use client';

import '@platform/ui-kit/ag-grid.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { GRID_DEFAULT_COL_DEF, scalePx } from '@platform/ui-kit/grid';
import { Modal, Button, buildFilename, exportRows } from '@platform/ui-kit';
import {
  leadPull,
  IMPORTABLE_PULL_VERDICTS,
  type PullVerdict,
  type StagedLeadRow,
} from '@/src/lib/api/client';

ModuleRegistry.registerModules([AllCommunityModule]);

const PAGE_SIZE = 200;

const VERDICT_LABELS: Record<string, string> = {
  new: 'New',
  phone_duplicate: 'Phone duplicate',
  email_duplicate: 'Email duplicate',
  already_synced: 'Already synced',
  test_lead: 'Test lead',
  unmapped_form: 'Unmapped form',
  missing_contact: 'Missing contact',
};

const VERDICT_CLASSES: Record<string, string> = {
  new: 'bg-status-success-container text-on-status-success-container',
  phone_duplicate: 'bg-status-info-container text-primary',
  email_duplicate: 'bg-status-info-container text-primary',
  already_synced: 'bg-surface-container text-on-surface-variant',
  test_lead: 'bg-surface-container text-on-surface-variant',
  unmapped_form: 'bg-status-due-container text-on-status-due-container',
  missing_contact: 'bg-status-due-container text-on-status-due-container',
};

const APPLIED_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  applied: 'Applied',
  skipped: 'Skipped',
  failed: 'Failed',
};

const APPLIED_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-surface-container text-on-surface-variant',
  applied: 'bg-status-success-container text-on-status-success-container',
  skipped: 'bg-surface-container text-on-surface-variant',
  failed: 'bg-error-container text-on-error-container',
};

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

export default function StagedLeadsGrid({ tenantId, runId, verdict, title, pageNames, orgNames, canSelect, onSelectionChanged, onClose }: Props) {
  const [rows, setRows] = useState<StagedLeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadPage = useCallback((p: number, append: boolean) => {
    setLoading(true);
    setError(null);
    leadPull.listLeads(tenantId, runId, verdict, p, PAGE_SIZE)
      .then((res) => {
        setRows((prev) => (append ? [...prev, ...res.data] : res.data));
        setTotal(res.total);
        setPage(p);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load staged leads.'))
      .finally(() => setLoading(false));
  }, [tenantId, runId, verdict]);

  useEffect(() => {
    loadPage(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, runId, verdict]);

  const isTickable = (r: StagedLeadRow | undefined): boolean =>
    !!r && !!canSelect && r.applied_status === 'pending' && !!r.verdict && IMPORTABLE_PULL_VERDICTS.includes(r.verdict);

  // Saves ONE row's tick, optimistically; a failure puts it back and says so.
  const toggleRow = useCallback((row: StagedLeadRow, selected: boolean) => {
    setError(null);
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, apply_selected: selected } : r)));
    leadPull.setSelection(tenantId, runId, { selected, ids: [row.id] })
      .then(() => onSelectionChanged?.())
      .catch((err: unknown) => {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, apply_selected: !selected } : r)));
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
        const res = await leadPull.listLeads(tenantId, runId, verdict, p, 500);
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
        buildFilename(['staged-leads', verdict ?? 'all']),
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

  const onGridReady = useCallback((params: GridReadyEvent<StagedLeadRow>) => {
    params.api.sizeColumnsToFit();
  }, []);
  const onGridSizeChanged = useCallback((params: GridSizeChangedEvent<StagedLeadRow>) => {
    params.api.sizeColumnsToFit();
  }, []);

  // Stable module-level reference — never wrapped in useMemo.
  const defaultColDef: ColDef = GRID_DEFAULT_COL_DEF;

  const hasMore = rows.length < total;

  return (
    <Modal open onClose={onClose} title={title} closeOnBackdropClick maxWidth="max-w-5xl">
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
          <div className="ag-theme-alpine" style={{ height: 480, width: '100%' }}>
            <AgGridReact<StagedLeadRow>
              rowData={rows}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              rowHeight={scalePx(44)}
              headerHeight={scalePx(40)}
              animateRows={false}
              suppressCellFocus={false}
              enableCellTextSelection
              onGridReady={onGridReady}
              onGridSizeChanged={onGridSizeChanged}
              getRowId={(params) => params.data.id}
              overlayNoRowsTemplate={loading ? 'Loading…' : 'No staged leads for this filter.'}
            />
          </div>
        </div>
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
