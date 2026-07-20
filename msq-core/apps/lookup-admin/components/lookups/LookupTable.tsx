'use client';

import './ag-grid.css';
import { useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { LookupTableDef } from '@/src/lib/lookupTableConfig';

ModuleRegistry.registerModules([AllCommunityModule]);

export type LookupRow = Record<string, unknown> & {
  id: string;
  name: string;
  label: string;
  is_active: boolean;
};

interface Props {
  config: LookupTableDef;
  rows: LookupRow[];
  onEdit: (row: LookupRow) => void;
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
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
}

export default function LookupTable({ config, rows, onEdit }: Props) {
  // Most lookup tables have both a "label" (display) and a "name" (code)
  // field, rendered as primary + subtitle. Tables like tenants/organizations
  // only have "name" — fall back to a single-line primary cell so we never
  // render an empty "—" title with the real value demoted to a subtitle.
  const hasLabelField = useMemo(
    () => config.fields.some((f) => f.key === 'label'),
    [config.fields],
  );

  const nameCellRenderer = useCallback((params: ICellRendererParams<LookupRow>) => {
    const r = params.data;
    if (!r) return null;
    if (!hasLabelField) {
      return (
        <div className="flex flex-col justify-center leading-tight">
          <p className="truncate text-sm font-semibold leading-tight text-[#0F172A]">{r.name ?? '—'}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm font-semibold leading-tight text-[#0F172A]">{r.label ?? r.name ?? '—'}</p>
        <p className="truncate text-[11px] leading-tight text-[#64748B]">{r.name ?? ''}</p>
      </div>
    );
  }, [hasLabelField]);

  const statusCellRenderer = useCallback((params: ICellRendererParams<LookupRow>) => {
    if (!params.data) return null;
    return <StatusBadge active={params.data.is_active} />;
  }, []);

  const actionsCellRenderer = useCallback((params: ICellRendererParams<LookupRow>) => {
    const r = params.data;
    if (!r) return null;
    return (
      <button
        type="button"
        onClick={() => onEdit(r)}
        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
      >
        Edit
      </button>
    );
  }, [onEdit]);

  const columnDefs = useMemo((): ColDef<LookupRow>[] => {
    const cols: ColDef<LookupRow>[] = [
      {
        colId: 'name', headerName: 'Name', width: 220, minWidth: 180, sortable: true, filter: true, editable: false,
        valueGetter: (p) => (hasLabelField ? p.data?.label ?? p.data?.name ?? '' : p.data?.name ?? ''),
        cellRenderer: nameCellRenderer,
      },
    ];

    for (const field of config.fields) {
      if (field.key === 'name' || field.key === 'label' || field.key === 'is_active') continue;

      if (field.type === 'boolean') {
        cols.push({
          colId: field.key, headerName: field.label, width: 150, sortable: true, filter: true, editable: false,
          valueGetter: (p) => (p.data?.[field.key] ? 'Yes' : 'No'),
          cellRenderer: (p: ICellRendererParams<LookupRow>) => (
            <span className={p.data?.[field.key] ? 'text-emerald-600' : 'text-[#94A3B8]'}>
              {p.data?.[field.key] ? '✓' : '—'}
            </span>
          ),
        });
        continue;
      }

      if (field.type === 'select' || field.type === 'geo-select') {
        // Joined display fields follow the "<relation>_label" / "<relation>_name"
        // convention (e.g. stage_id -> stage_label / stage_name) per the backend contract.
        const base = field.key.replace(/_id$/, '');
        const labelKey = `${base}_label`;
        const nameKey = `${base}_name`;
        cols.push({
          colId: field.key, headerName: field.label, width: 180, sortable: true, filter: true, editable: false,
          valueGetter: (p) => (p.data?.[labelKey] ?? p.data?.[nameKey] ?? p.data?.[field.key] ?? '—') as string,
        });
        continue;
      }

      cols.push({
        colId: field.key, headerName: field.label, width: 200, minWidth: 140, sortable: true, filter: true, editable: false,
        valueGetter: (p) => (p.data?.[field.key] ?? '') as string | number,
      });
    }

    cols.push({
      colId: 'status', headerName: 'Status', width: 130, sortable: true, filter: true, editable: false,
      valueGetter: (p) => (p.data?.is_active ? 'Active' : 'Inactive'),
      cellRenderer: statusCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    });

    cols.push({
      colId: '__actions', headerName: '', width: 100, minWidth: 100, maxWidth: 100,
      pinned: 'right', sortable: false, filter: false, editable: false, resizable: false,
      cellRenderer: actionsCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
    });

    return cols;
  }, [config.fields, hasLabelField, nameCellRenderer, statusCellRenderer, actionsCellRenderer]);

  const onGridReady = useCallback((params: GridReadyEvent<LookupRow>) => {
    params.api.sizeColumnsToFit();
  }, []);
  const onGridSizeChanged = useCallback((params: GridSizeChangedEvent<LookupRow>) => {
    params.api.sizeColumnsToFit();
  }, []);

  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true,
    suppressMovable: false,
    cellStyle: { fontSize: '13px', color: '#0F172A' },
  }), []);

  return (
    <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
        <AgGridReact<LookupRow>
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
          overlayNoRowsTemplate="No rows found."
        />
      </div>
    </div>
  );
}
