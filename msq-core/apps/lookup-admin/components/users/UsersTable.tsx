'use client';

import '../lookups/ag-grid.css';
import { useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { UserRow } from '@/src/lib/api/client';
import UserStatusBadge from './UserStatusBadge';

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  users: UserRow[];
  currentUserId: string;
  onEdit: (user: UserRow) => void;
}

export function userDisplayName(u: UserRow): string {
  return [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ').trim();
}

export default function UsersTable({ users, currentUserId, onEdit }: Props) {
  const nameCellRenderer = useCallback((params: ICellRendererParams<UserRow>) => {
    const u = params.data;
    if (!u) return null;
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm font-semibold leading-tight text-[#0F172A]">
          {userDisplayName(u) || '—'}
          {u.id === currentUserId && (
            <span className="ml-2 text-[10px] font-semibold uppercase text-[#0b6cbf]">(you)</span>
          )}
        </p>
        {u.role_label && <p className="truncate text-[11px] leading-tight text-[#64748B]">{u.role_label}</p>}
      </div>
    );
  }, [currentUserId]);

  const statusCellRenderer = useCallback((params: ICellRendererParams<UserRow>) => {
    if (!params.data) return null;
    return <UserStatusBadge active={params.data.is_active} />;
  }, []);

  // Every row is always editable — this app is entirely super_admin-gated
  // (see app/dashboard/layout.tsx), so unlike apps/web's UsersTable there is
  // no per-row canEditRow / "View only" branching to preserve here.
  // Reset password lives inside the Edit modal, not as a separate grid
  // action — avoids a duplicate entry point to the same flow.
  const actionsCellRenderer = useCallback((params: ICellRendererParams<UserRow>) => {
    const u = params.data;
    if (!u) return null;
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onEdit(u)}
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
        >
          Edit
        </button>
      </div>
    );
  }, [onEdit]);

  const columnDefs = useMemo((): ColDef<UserRow>[] => [
    {
      colId: 'name', headerName: 'Name', width: 220, minWidth: 180, sortable: true, filter: true, editable: false,
      valueGetter: (p) => (p.data ? userDisplayName(p.data) : ''),
      cellRenderer: nameCellRenderer,
    },
    {
      colId: 'email', headerName: 'Email', width: 240, minWidth: 200, sortable: true, filter: true, editable: false,
      valueGetter: (p) => p.data?.email ?? '',
    },
    {
      colId: 'role_label', headerName: 'Role', width: 180, sortable: true, filter: true, editable: false,
      valueGetter: (p) => p.data?.role_label ?? '',
    },
    {
      colId: 'org_name', headerName: 'Org', width: 180, sortable: true, filter: true, editable: false,
      valueGetter: (p) => p.data?.org_name || '—',
    },
    {
      colId: 'status', headerName: 'Status', width: 130, sortable: true, filter: true, editable: false,
      valueGetter: (p) => (p.data?.is_active ? 'Active' : 'Inactive'),
      cellRenderer: statusCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: '__actions', headerName: '', width: 100, minWidth: 100, maxWidth: 100,
      pinned: 'right', sortable: false, filter: false, editable: false, resizable: false,
      cellRenderer: actionsCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
    },
  ], [nameCellRenderer, statusCellRenderer, actionsCellRenderer]);

  const onGridReady = useCallback((params: GridReadyEvent<UserRow>) => {
    params.api.sizeColumnsToFit();
  }, []);
  const onGridSizeChanged = useCallback((params: GridSizeChangedEvent<UserRow>) => {
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
        <AgGridReact<UserRow>
          rowData={users}
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
          overlayNoRowsTemplate="No users found."
        />
      </div>
    </div>
  );
}
