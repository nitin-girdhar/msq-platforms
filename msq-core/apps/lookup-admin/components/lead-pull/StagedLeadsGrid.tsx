'use client';

import '@/components/lookups/ag-grid.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { GRID_DEFAULT_COL_DEF } from '@platform/ui-kit/grid';
import { Modal, Button } from '@platform/ui-kit';
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
  new: 'bg-emerald-50 text-emerald-700',
  phone_duplicate: 'bg-sky-50 text-sky-700',
  email_duplicate: 'bg-sky-50 text-sky-700',
  already_synced: 'bg-slate-100 text-slate-500',
  test_lead: 'bg-slate-100 text-slate-500',
  unmapped_form: 'bg-amber-50 text-amber-800',
  missing_contact: 'bg-amber-50 text-amber-800',
};

const APPLIED_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  applied: 'Applied',
  skipped: 'Skipped',
  failed: 'Failed',
};

const APPLIED_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  applied: 'bg-emerald-50 text-emerald-700',
  skipped: 'bg-slate-100 text-slate-500',
  failed: 'bg-red-50 text-red-700',
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
  onClose: () => void;
}

export default function StagedLeadsGrid({ tenantId, runId, verdict, title, pageNames, onClose }: Props) {
  const [rows, setRows] = useState<StagedLeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

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

  const pageCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const id = p.data?.page_id ?? '';
    const name = pageNames[id];
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm text-[#0F172A]">{name ?? id}</p>
        {name ? <p className="truncate font-mono text-[11px] leading-tight text-[#64748B]">{id}</p> : null}
      </div>
    );
  }, [pageNames]);

  const verdictCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const v = p.data?.verdict;
    if (!v) return null;
    return badge(VERDICT_LABELS[v] ?? v, VERDICT_CLASSES[v] ?? 'bg-slate-100 text-slate-600');
  }, []);

  const hiringCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    if (!p.data?.is_hiring_form) return null;
    return (
      <span
        className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700"
        title={p.data.suggested_campaign_type_label ? `Suggested type: ${p.data.suggested_campaign_type_label}` : 'No matching campaign type found'}
      >
        Hiring{p.data.suggested_campaign_type_label ? ` → ${p.data.suggested_campaign_type_label}` : ''}
      </span>
    );
  }, []);

  const appliedStatusCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const s = p.data?.applied_status;
    if (!s) return null;
    return badge(APPLIED_STATUS_LABELS[s] ?? s, APPLIED_STATUS_CLASSES[s] ?? 'bg-slate-100 text-slate-600');
  }, []);

  const importableCellRenderer = useCallback((p: ICellRendererParams<StagedLeadRow>) => {
    const v = p.data?.verdict;
    if (!v || !IMPORTABLE_PULL_VERDICTS.includes(v)) return <span className="text-[#94A3B8]">—</span>;
    return <span className="text-emerald-600">✓</span>;
  }, []);

  const columnDefs = useMemo((): ColDef<StagedLeadRow>[] => [
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
      valueGetter: (p) => (p.data?.is_hiring_form ? `Hiring${p.data.suggested_campaign_type_label ? ` → ${p.data.suggested_campaign_type_label}` : ''}` : ''),
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
  ], [pageNames, pageCellRenderer, verdictCellRenderer, importableCellRenderer, hiringCellRenderer, appliedStatusCellRenderer]);

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
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <p className="text-xs text-[#64748B]">
          {total.toLocaleString()} row{total === 1 ? '' : 's'}{rows.length < total ? ` — showing ${rows.length.toLocaleString()}` : ''}
        </p>
        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <div className="ag-theme-alpine" style={{ height: 480, width: '100%' }}>
            <AgGridReact<StagedLeadRow>
              rowData={rows}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              rowHeight={44}
              headerHeight={40}
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
