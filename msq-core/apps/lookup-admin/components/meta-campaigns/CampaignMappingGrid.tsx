'use client';

import '@/components/lookups/ag-grid.css';
import { useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { GRID_DEFAULT_COL_DEF } from '@platform/ui-kit/grid';
import type { SearchableOption } from '@platform/ui-kit';
import type { MetaCampaignRow } from '@/src/lib/api/client';

ModuleRegistry.registerModules([AllCommunityModule]);

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAUSED: 'bg-slate-100 text-slate-600',
  ARCHIVED: 'bg-slate-100 text-slate-500',
  DELETED: 'bg-red-50 text-red-700',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
}

export type GridMode = 'suggested' | 'unmapped' | 'confirmed';

interface Props {
  mode: GridMode;
  rows: MetaCampaignRow[];
  campaignTypeOptions: SearchableOption[];
  // Keyed by meta_campaign_id -> chosen campaign_type_id. Owned by the Shell so
  // "Confirm all" can read every row's current pick in one place.
  selections: Record<string, string>;
  onSelectionChange: (metaCampaignId: string, campaignTypeId: string) => void;
  onConfirmOne: (row: MetaCampaignRow) => void;
  onEdit?: (row: MetaCampaignRow) => void;
}

export default function CampaignMappingGrid({
  mode,
  rows,
  campaignTypeOptions,
  selections,
  onSelectionChange,
  onConfirmOne,
  onEdit,
}: Props) {
  const statusCellRenderer = useCallback((p: ICellRendererParams<MetaCampaignRow>) => {
    const status = p.data?.effective_status;
    if (!status) return null;
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] ?? 'bg-slate-100 text-slate-600'}`}>
        {status}
      </span>
    );
  }, []);

  // Suggested/unmapped rows get an inline, editable dropdown — the point of
  // this grid is judging the matcher's suggestion (or picking one from
  // scratch) without opening a dialog first. Confirmed rows show the
  // committed label only; changing it goes through Edit -> the modal instead,
  // since there is no in-grid draft state to protect there.
  const typeCellRenderer = useCallback((p: ICellRendererParams<MetaCampaignRow>) => {
    const row = p.data;
    if (!row) return null;
    if (mode === 'confirmed') {
      return <span className="text-sm text-[#0F172A]">{row.campaign_type_label ?? '—'}</span>;
    }
    return (
      <select
        value={selections[row.meta_campaign_id] ?? ''}
        onChange={(e) => onSelectionChange(row.meta_campaign_id, e.target.value)}
        aria-label={`Campaign type for ${row.name ?? row.meta_campaign_id}`}
        className="w-full max-w-[220px] rounded-lg border border-[#E2E8F0] bg-white px-2 py-1 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
      >
        <option value="">— Select type —</option>
        {campaignTypeOptions.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    );
  }, [mode, selections, campaignTypeOptions, onSelectionChange]);

  const actionsCellRenderer = useCallback((p: ICellRendererParams<MetaCampaignRow>) => {
    const row = p.data;
    if (!row) return null;
    if (mode === 'confirmed') {
      return (
        <button
          type="button"
          onClick={() => onEdit?.(row)}
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
        >
          Edit
        </button>
      );
    }
    const selected = selections[row.meta_campaign_id];
    return (
      <button
        type="button"
        onClick={() => onConfirmOne(row)}
        disabled={!selected}
        className="rounded-lg bg-[#0b6cbf] px-3 py-1 text-xs font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Confirm
      </button>
    );
  }, [mode, selections, onConfirmOne, onEdit]);

  // Every cellRenderer that draws a LABEL (Meta status, the type dropdown's
  // current choice) has a matching valueGetter returning that same label — the
  // rule documented in @platform/ui-kit/grid's gridDefaults. Skipping it here
  // would make the column filter and sort run against the raw id/status while
  // the user reads a human label.
  const columnDefs = useMemo((): ColDef<MetaCampaignRow>[] => {
    const cols: ColDef<MetaCampaignRow>[] = [
      {
        colId: 'name', headerName: 'Campaign', flex: 2, minWidth: 220, sortable: true, filter: true,
        valueGetter: (p) => p.data?.name ?? p.data?.meta_campaign_id ?? '',
      },
      {
        colId: 'ad_account_id', headerName: 'Ad account', width: 180, minWidth: 150, sortable: true, filter: true,
        valueGetter: (p) => p.data?.ad_account_id ?? '',
      },
      {
        colId: 'effective_status', headerName: 'Meta status', width: 130, sortable: true, filter: true,
        valueGetter: (p) => p.data?.effective_status ?? '',
        cellRenderer: statusCellRenderer,
        cellStyle: { display: 'flex', alignItems: 'center' },
      },
    ];

    if (mode === 'suggested') {
      cols.push({
        colId: 'matched_keyword', headerName: 'Matched keyword', width: 160, minWidth: 140, sortable: true, filter: true,
        valueGetter: (p) => p.data?.matched_keyword ?? '',
      });
    }

    cols.push({
      colId: 'type', headerName: mode === 'confirmed' ? 'Type' : 'Suggested type', width: 220, minWidth: 200, sortable: true, filter: true,
      valueGetter: (p) => {
        if (!p.data) return '';
        if (mode === 'confirmed') return p.data.campaign_type_label ?? '';
        return campaignTypeOptions.find((t) => t.id === selections[p.data!.meta_campaign_id])?.label ?? '';
      },
      cellRenderer: typeCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    });

    cols.push({
      colId: 'lead_count', headerName: 'Leads so far', width: 120, sortable: true, filter: 'agNumberColumnFilter',
      valueGetter: (p) => p.data?.lead_count ?? 0,
    });

    if (mode === 'confirmed') {
      cols.push(
        {
          colId: 'confirmed_by', headerName: 'Confirmed by', width: 160, minWidth: 140, sortable: true, filter: true,
          valueGetter: (p) => p.data?.confirmed_by ?? '',
        },
        {
          colId: 'confirmed_at', headerName: 'Confirmed at', width: 180, minWidth: 150, sortable: true, filter: true,
          valueGetter: (p) => formatDate(p.data?.confirmed_at),
        },
      );
    }

    cols.push({
      colId: 'last_synced_at', headerName: 'Last synced', width: 180, minWidth: 150, sortable: true, filter: true,
      valueGetter: (p) => formatDate(p.data?.last_synced_at),
    });

    cols.push({
      colId: '__actions', headerName: '', width: 110, minWidth: 110, maxWidth: 110,
      pinned: 'right', sortable: false, filter: false, resizable: false,
      cellRenderer: actionsCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
    });

    return cols;
  }, [mode, campaignTypeOptions, selections, statusCellRenderer, typeCellRenderer, actionsCellRenderer]);

  const onGridReady = useCallback((params: GridReadyEvent<MetaCampaignRow>) => {
    params.api.sizeColumnsToFit();
  }, []);
  const onGridSizeChanged = useCallback((params: GridSizeChangedEvent<MetaCampaignRow>) => {
    params.api.sizeColumnsToFit();
  }, []);

  // Shared across every grid in the platform — a stable module-level
  // reference, assigned directly rather than wrapped in useMemo.
  const defaultColDef: ColDef = GRID_DEFAULT_COL_DEF;

  return (
    <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <div className="ag-theme-alpine" style={{ height: 420, width: '100%' }}>
        <AgGridReact<MetaCampaignRow>
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          pagination
          paginationPageSize={25}
          paginationPageSizeSelector={[25, 50, 100]}
          rowHeight={44}
          headerHeight={40}
          animateRows={false}
          suppressCellFocus={false}
          enableCellTextSelection
          onGridReady={onGridReady}
          onGridSizeChanged={onGridSizeChanged}
          getRowId={(params) => params.data.id}
          overlayNoRowsTemplate="No campaigns in this category."
        />
      </div>
    </div>
  );
}
