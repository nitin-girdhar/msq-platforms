'use client';

import '@platform/ui-kit/ag-grid.css';
import { useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { LookupTableDef } from '@/src/lib/lookupTableConfig';
import { GRID_COL, GRID_DEFAULT_COL_DEF, scalePx } from '@platform/ui-kit/grid';

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
    <span className="inline-flex items-center gap-1.5 rounded-full bg-status-success-container px-2 py-0.5 text-xs font-medium text-on-status-success-container">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-2 py-0.5 text-xs font-medium text-on-surface-variant">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-outline-variant" />
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
          <p className="truncate text-sm font-semibold leading-tight text-on-surface">{r.name ?? '—'}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm font-semibold leading-tight text-on-surface">{r.label ?? r.name ?? '—'}</p>
        <p className="truncate text-[0.6875rem] leading-tight text-on-surface-variant">{r.name ?? ''}</p>
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
        className="min-h-[2.75rem] rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low sm:min-h-0"
      >
        Edit
      </button>
    );
  }, [onEdit]);

  const columnDefs = useMemo((): ColDef<LookupRow>[] => {
    const cols: ColDef<LookupRow>[] = [
      {
        colId: 'name', headerName: 'Name', ...GRID_COL.wide, pinned: 'left', sortable: true, filter: true, editable: false,
        valueGetter: (p) => (hasLabelField ? p.data?.label ?? p.data?.name ?? '' : p.data?.name ?? ''),
        cellRenderer: nameCellRenderer,
      },
    ];

    for (const field of config.fields) {
      if (field.key === 'name' || field.key === 'label' || field.key === 'is_active') continue;

      if (field.type === 'boolean') {
        cols.push({
          colId: field.key, headerName: field.label, ...GRID_COL.badge, sortable: true, filter: true, editable: false,
          valueGetter: (p) => (p.data?.[field.key] ? 'Yes' : 'No'),
          cellRenderer: (p: ICellRendererParams<LookupRow>) => (
            <span className={p.data?.[field.key] ? 'text-on-status-success-container' : 'text-outline'}>
              {p.data?.[field.key] ? '✓' : '—'}
            </span>
          ),
        });
        continue;
      }

      if (field.type === 'fk') {
        // Joined display fields follow the "<relation>_label" / "<relation>_name"
        // convention (e.g. stage_id -> stage_label / stage_name) per the backend contract.
        const base = field.key.replace(/_id$/, '');
        const labelKey = `${base}_label`;
        const nameKey = `${base}_name`;
        cols.push({
          colId: field.key, headerName: field.label, ...GRID_COL.text, sortable: true, filter: true, editable: false,
          valueGetter: (p) => (p.data?.[labelKey] ?? p.data?.[nameKey] ?? p.data?.[field.key] ?? '—') as string,
        });
        continue;
      }

      cols.push({
        colId: field.key, headerName: field.label, ...(field.type === 'number' ? GRID_COL.number : GRID_COL.text), sortable: true, filter: true, editable: false,
        valueGetter: (p) => (p.data?.[field.key] ?? '') as string | number,
      });
    }

    cols.push({
      colId: 'status', headerName: 'Status', ...GRID_COL.badge, sortable: true, filter: true, editable: false,
      valueGetter: (p) => (p.data?.is_active ? 'Active' : 'Inactive'),
      cellRenderer: statusCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    });

    cols.push({
      colId: '__actions', headerName: '', ...GRID_COL.actions(100),
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

  // Shared across every grid in the platform — case/accent-insensitive column
  // filtering lives in @platform/ui-kit/grid, not in a per-file literal.
  const defaultColDef: ColDef = GRID_DEFAULT_COL_DEF;

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
        <AgGridReact<LookupRow>
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          pagination
          paginationPageSize={25}
          paginationPageSizeSelector={[25, 50, 100]}
          rowHeight={scalePx(44)}
          headerHeight={scalePx(40)}
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
