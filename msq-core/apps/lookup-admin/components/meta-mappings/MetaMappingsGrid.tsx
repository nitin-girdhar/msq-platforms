'use client';

import '@/components/lookups/ag-grid.css';
import { useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { GRID_DEFAULT_COL_DEF } from '@platform/ui-kit/grid';
import type { MetaPageOrgMapRow, MetaPlatform } from '@/src/lib/api/client';

ModuleRegistry.registerModules([AllCommunityModule]);

const PLATFORM_LABELS: Record<MetaPlatform, string> = {
  fb: 'Facebook',
  ig: 'Instagram',
  wa: 'WhatsApp',
};

const PLATFORM_CLASSES: Record<MetaPlatform, string> = {
  fb: 'bg-blue-50 text-blue-700',
  ig: 'bg-pink-50 text-pink-700',
  wa: 'bg-emerald-50 text-emerald-700',
};

// The whole point of the screen: a NULL form_id is a page-level catch-all, and
// it has to be legible as such at a glance rather than as an empty cell that
// reads like missing data.
const PAGE_LEVEL_LABEL = 'All forms (page-level)';

interface Props {
  rows: MetaPageOrgMapRow[];
  pageNames: Record<string, string>;
  orgNames: Record<string, string>;
  onEdit: (row: MetaPageOrgMapRow) => void;
}

function platformLabel(platform: MetaPlatform | undefined): string {
  return platform ? PLATFORM_LABELS[platform] ?? platform : '';
}

function formatSyncedAt(value: string | null | undefined): string {
  if (!value) return 'Never';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
}

export default function MetaMappingsGrid({ rows, pageNames, orgNames, onEdit }: Props) {
  const pageCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    const id = p.data?.page_id ?? '';
    const name = pageNames[id];
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm font-semibold leading-tight text-[#0F172A]">{name ?? id}</p>
        {name ? <p className="truncate font-mono text-[11px] leading-tight text-[#64748B]">{id}</p> : null}
      </div>
    );
  }, [pageNames]);

  const platformCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    const platform = p.data?.platform;
    if (!platform) return null;
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PLATFORM_CLASSES[platform] ?? 'bg-slate-100 text-slate-600'}`}>
        {platformLabel(platform)}
      </span>
    );
  }, []);

  const statusCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    if (!p.data) return null;
    return p.data.is_active ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        Active
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
        Inactive
      </span>
    );
  }, []);

  const formCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    const row = p.data;
    if (!row) return null;
    if (row.form_id === null) {
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
          {PAGE_LEVEL_LABEL}
        </span>
      );
    }
    return <span className="font-mono text-xs text-[#0F172A]">{row.form_id}</span>;
  }, []);

  const actionsCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    const row = p.data;
    if (!row) return null;
    return (
      <button
        type="button"
        onClick={() => onEdit(row)}
        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
      >
        Edit
      </button>
    );
  }, [onEdit]);

  // Every cellRenderer that draws a LABEL gets a valueGetter returning that
  // same label — the rule documented in @platform/ui-kit/grid's gridDefaults.
  // Without it the column filter and the sort run against the raw field
  // ('fb', null, true) while the user is reading 'Facebook' /
  // 'All forms (page-level)' / 'Active', so typing the visible text into the
  // filter matches nothing and the sort order looks arbitrary.
  const columnDefs = useMemo((): ColDef<MetaPageOrgMapRow>[] => [
    {
      colId: 'page', headerName: 'Page', width: 240, minWidth: 180, sortable: true, filter: true,
      valueGetter: (p) => {
        const id = p.data?.page_id ?? '';
        const name = pageNames[id];
        return name ? `${name} (${id})` : id;
      },
      cellRenderer: pageCellRenderer,
    },
    {
      colId: 'form_id', headerName: 'Form', width: 200, minWidth: 160, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.form_id === null ? PAGE_LEVEL_LABEL : p.data?.form_id ?? ''),
      cellRenderer: formCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'org', headerName: 'Branch', width: 200, minWidth: 160, sortable: true, filter: true,
      valueGetter: (p) => orgNames[p.data?.org_id ?? ''] ?? p.data?.org_id ?? '',
    },
    {
      colId: 'platform', headerName: 'Platform', width: 140, sortable: true, filter: true,
      valueGetter: (p) => platformLabel(p.data?.platform),
      cellRenderer: platformCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'is_active', headerName: 'Status', width: 130, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.is_active ? 'Active' : 'Inactive'),
      cellRenderer: statusCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'last_synced_at', headerName: 'Last synced', width: 190, minWidth: 150, sortable: true, filter: true,
      valueGetter: (p) => formatSyncedAt(p.data?.last_synced_at),
    },
    {
      colId: '__actions', headerName: '', width: 100, minWidth: 100, maxWidth: 100,
      pinned: 'right', sortable: false, filter: false, resizable: false,
      cellRenderer: actionsCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
    },
  ], [pageNames, orgNames, pageCellRenderer, formCellRenderer, platformCellRenderer, statusCellRenderer, actionsCellRenderer]);

  const onGridReady = useCallback((params: GridReadyEvent<MetaPageOrgMapRow>) => {
    params.api.sizeColumnsToFit();
  }, []);
  const onGridSizeChanged = useCallback((params: GridSizeChangedEvent<MetaPageOrgMapRow>) => {
    params.api.sizeColumnsToFit();
  }, []);

  // Shared across every grid in the platform — case/accent-insensitive column
  // filtering lives in @platform/ui-kit/grid, not in a per-file literal. It is a
  // stable module-level reference, so it is assigned directly; a useMemo here
  // would only memoize a constant.
  const defaultColDef: ColDef = GRID_DEFAULT_COL_DEF;

  return (
    <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
        <AgGridReact<MetaPageOrgMapRow>
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
          overlayNoRowsTemplate="No Meta page mappings for this scope."
        />
      </div>
    </div>
  );
}
