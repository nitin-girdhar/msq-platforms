'use client';

import '@platform/ui-kit/ag-grid.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  GridApi,
  GridReadyEvent,
  GridSizeChangedEvent,
  ICellRendererParams,
  IRowNode,
} from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { OrgMembership, SessionUser } from '@platform/types';
import { ROLES, ROLE_LABELS, ROLE_RANK } from '@platform/auth-constants';
import { RANKS } from '@platform/authz';
import {
  useIsMobile,
  DownloadButton,
  FilterField,
  MultiSelect,
  type SelectOption,
  buildFilename,
  exportRows,
  type ExportColumn,
  type ExportRowsFormat as ExportFormat,
} from '@platform/ui-kit';
import { canCreateUser } from '../../lib/permissions';
import type { TeamRow } from '../../lib/types';
import UserStatusBadge from './UserStatusBadge';
import { GRID_DEFAULT_COL_DEF } from '@platform/ui-kit/grid';

ModuleRegistry.registerModules([AllCommunityModule]);

// Wider than the grid on purpose: an export is for working offline, so it
// carries the columns the screen renders as subtitles or not at all (Role, Last
// Login). Ported from lms-web's Users table, which had this before the two
// screens were merged — admin-web's Team never did.
const USER_EXPORT_COLUMNS: ExportColumn<SessionUser>[] = [
  { header: 'Name', value: (u) => u.name ?? '' },
  { header: 'Role', value: (u) => u.role_label ?? ROLE_LABELS[u.role] ?? '' },
  { header: 'Email', value: (u) => u.email },
  { header: 'Branch', value: (u) => u.org_name ?? '' },
  { header: 'Manager', value: (u) => u.manager_name ?? '' },
  { header: 'Status', value: (u) => (u.is_active ? 'Active' : 'Inactive') },
  { header: 'Last Login', value: (u) => u.last_login_at ?? '' },
];

interface Props {
  users: TeamRow[];
  currentUserId: string;
  actorRank: number;
  /** Every branch in the tenant, for the Branch filter's option list. */
  orgs: Array<{ id: string; name: string }>;
  /** Holds admin.team.manage. Without it every row is read-only, however senior
   *  the actor — the capability answers "may they write", rank answers "whom". */
  canManage: boolean;
  onEdit: (user: SessionUser) => void;
}

function displayName(u: SessionUser): string {
  return (u.name || [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ')).trim();
}

// A user can be mapped into several branches (iam.user_org_mapping); org_id /
// org_name are only their HOME one. Reading the memberships is what keeps a
// multi-branch user — a wingman working two sectors, say — visible when the
// Branch filter names one of their non-home branches. The fallback covers a row
// from before the API returned the list.
function branchesOf(u: SessionUser): OrgMembership[] {
  if (u.org_memberships && u.org_memberships.length > 0) return u.org_memberships;
  if (!u.org_id) return [];
  return [{ org_id: u.org_id, org_name: u.org_name || u.org_id, role_label: u.role_label, is_home: true }];
}

const STATUS_OPTIONS: SelectOption[] = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

export default function TeamTable({ users, currentUserId, actorRank, orgs, canManage, onEdit }: Props) {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [roleSelected, setRoleSelected] = useState<SelectOption[]>([]);
  const [statusSelected, setStatusSelected] = useState<SelectOption[]>([]);
  const [orgSelected, setOrgSelected] = useState<SelectOption[]>([]);
  const [managerSelected, setManagerSelected] = useState<SelectOption[]>([]);

  // Org/manager filters only make sense for actors who actually see users across
  // more than one branch — tenant admin+ (users.service.ts's tenantWide listing).
  // Everyone else's roster is already a single org, so the pickers would be dead UI.
  const showCrossOrgFilters = actorRank >= RANKS.TENANT_ADMIN;

  const roleOptions = useMemo(
    () => ROLES.filter((r) => canCreateUser(actorRank, ROLE_RANK[r] ?? 0)).map((r) => ({ id: r, label: ROLE_LABELS[r] })),
    [actorRank],
  );

  // The tenant's full branch list, not the branches the loaded rows happen to
  // call home: a branch staffed only by people whose home is elsewhere had no
  // option at all before, so it could never be filtered for. The derivation is
  // kept as a fallback because /orgs/all is fetched non-fatally (branchesFailed)
  // and can come back empty.
  const orgOptions = useMemo(() => {
    if (orgs.length > 0) {
      return orgs.map((o) => ({ id: o.id, label: o.name })).sort((a, b) => a.label.localeCompare(b.label));
    }
    const seen = new Map<string, string>();
    for (const u of users) {
      for (const b of branchesOf(u)) if (!seen.has(b.org_id)) seen.set(b.org_id, b.org_name || b.org_id);
    }
    return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orgs, users]);

  const managerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const u of users) {
      if (u.manager_id && !seen.has(u.manager_id)) seen.set(u.manager_id, u.manager_name || u.manager_id);
    }
    return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const userById = useMemo(() => {
    const map = new Map<string, SessionUser>();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  // Both gates, ANDed. Rank alone used to be enough because the console's rank
  // floor meant everyone here could write; now a view-only actor can reach this
  // screen and outrank plenty of rows, and offering them an Edit button the
  // server would refuse is the render-then-403 shape the capability model
  // exists to remove.
  const canEditRow = useCallback(
    (u: SessionUser) => canManage && canCreateUser(actorRank, u.rank),
    [canManage, actorRank],
  );

  // Single source of truth for "does this row match the active filters",
  // shared by the AG Grid external-filter hooks (desktop) and the plain JS
  // `filtered` array (mobile list, count badge, CSV export). Keeping AG
  // Grid's own rowData stable and routing filtering through this predicate
  // instead of reassigning rowData on every keystroke is what keeps the
  // grid's sort in sync — see isExternalFilterPresent/doesExternalFilterPass
  // below.
  const matchesFilters = useCallback(
    (u: SessionUser) => {
      const q = search.trim().toLowerCase();
      const roleIds = new Set(roleSelected.map((o) => o.id));
      const statusIds = new Set(statusSelected.map((o) => o.id));
      const orgIds = new Set(orgSelected.map((o) => o.id));
      const managerIds = new Set(managerSelected.map((o) => o.id));
      if (statusIds.size > 0 && !statusIds.has(u.is_active ? 'active' : 'inactive')) return false;
      if (roleIds.size > 0 && !roleIds.has(u.role)) return false;
      if (showCrossOrgFilters && orgIds.size > 0 && !branchesOf(u).some((b) => orgIds.has(b.org_id))) return false;
      if (showCrossOrgFilters && managerIds.size > 0 && !(u.manager_id && managerIds.has(u.manager_id))) return false;
      if (q) {
        const hay = `${u.email} ${displayName(u)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    },
    [search, roleSelected, statusSelected, orgSelected, managerSelected, showCrossOrgFilters],
  );

  const filtered = useMemo(() => users.filter(matchesFilters), [users, matchesFilters]);

  const exportUsers = (format: ExportFormat) => {
    exportRows(filtered, USER_EXPORT_COLUMNS, buildFilename(['team']), format);
  };

  const nameCellRenderer = useCallback((params: ICellRendererParams<SessionUser>) => {
    const u = params.data;
    if (!u) return null;
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm font-semibold leading-tight text-[#0F172A]">
          {displayName(u) || '—'}
          {u.id === currentUserId && (
            <span className="ml-2 text-[10px] font-semibold uppercase text-[#0b6cbf]">(you)</span>
          )}
        </p>
        {u.role_label && <p className="truncate text-[11px] leading-tight text-[#64748B]">{u.role_label}</p>}
      </div>
    );
  }, [currentUserId]);

  // Read off the rows rather than taking the scope as a second prop: the server
  // is the one that decides whether this is a subtree view, and it already says
  // so by populating report_depth.
  const showDepth = useMemo(() => users.some((u) => u.report_depth != null), [users]);

  // Direct vs indirect report. Only meaningful under the `reports` scope, where
  // the roster IS a subtree — report_depth is null everywhere else, so an absent
  // value renders nothing rather than claiming "direct".
  const depthCellRenderer = useCallback((params: ICellRendererParams<TeamRow>) => {
    const d = params.data?.report_depth;
    if (d === null || d === undefined) return null;
    return d === 1 ? (
      <span className="rounded-md bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#1E40AF]">
        Direct
      </span>
    ) : (
      <span className="text-[11px] text-[#94A3B8]">{d} levels down</span>
    );
  }, []);

  const branchCellRenderer = useCallback((params: ICellRendererParams<SessionUser>) => {
    const u = params.data;
    if (!u) return null;
    const branches = branchesOf(u);
    if (branches.length === 0) return <span className="italic text-[#94A3B8]">—</span>;
    const all = branches.map((b) => b.org_name).join(', ');
    return (
      <div className="flex items-center gap-1.5 leading-tight" title={all}>
        <span className="truncate text-sm text-[#0F172A]">{branches[0]!.org_name}</span>
        {branches.length > 1 && (
          <span className="shrink-0 rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569]">
            +{branches.length - 1}
          </span>
        )}
      </div>
    );
  }, []);

  const managerCellRenderer = useCallback((params: ICellRendererParams<SessionUser>) => {
    const u = params.data;
    if (!u?.manager_id) return <span className="italic text-[#94A3B8]">—</span>;
    const manager = userById.get(u.manager_id);
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm leading-tight text-[#0F172A]">{u.manager_name ?? '—'}</p>
        {manager?.role_label && <p className="truncate text-[11px] leading-tight text-[#64748B]">{manager.role_label}</p>}
      </div>
    );
  }, [userById]);

  const statusCellRenderer = useCallback((params: ICellRendererParams<SessionUser>) => {
    if (!params.data) return null;
    return <UserStatusBadge active={params.data.is_active} />;
  }, []);

  const actionsCellRenderer = useCallback((params: ICellRendererParams<SessionUser>) => {
    const u = params.data;
    if (!u) return null;
    return canEditRow(u) ? (
      <button
        type="button"
        onClick={() => onEdit(u)}
        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
      >
        Edit
      </button>
    ) : (
      <span className="text-[10px] uppercase tracking-wide text-[#94A3B8]">View only</span>
    );
  }, [canEditRow, onEdit]);

  const columnDefs = useMemo((): ColDef<SessionUser>[] => [
    {
      colId: 'name', headerName: 'Name', width: 220, minWidth: 180, sortable: true, filter: true, editable: false,
      valueGetter: (p) => displayName(p.data as SessionUser) || '',
      cellRenderer: nameCellRenderer,
    },
    {
      colId: 'email', headerName: 'Email', width: 240, minWidth: 200, sortable: true, filter: true, editable: false,
      valueGetter: (p) => p.data?.email ?? '',
    },
    {
      colId: 'role_label', headerName: 'Role', width: 160, sortable: true, filter: true, editable: false,
      valueGetter: (p) => p.data?.role_label || p.data?.role || '',
    },
    {
      colId: 'org_name', headerName: 'Branch', width: 160, sortable: true, filter: true, editable: false,
      // Every branch, so AG Grid's own column filter, sort and CSV export all
      // see the full membership rather than just the home branch the cell leads
      // with.
      valueGetter: (p) => (p.data ? branchesOf(p.data).map((b) => b.org_name).join(', ') : '') || '—',
      cellRenderer: branchCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'manager_name', headerName: 'Manager', width: 180, sortable: true, filter: true, editable: false,
      valueGetter: (p) => p.data?.manager_name ?? '',
      cellRenderer: managerCellRenderer,
    },
    // Only under the `reports` scope: elsewhere every value is null and the
    // column would be an empty stripe down the grid.
    ...(showDepth
      ? [{
          colId: 'report_depth', headerName: 'Reports', width: 130, sortable: true, filter: false, editable: false,
          valueGetter: (p: { data?: TeamRow }) => p.data?.report_depth ?? null,
          cellRenderer: depthCellRenderer,
          cellStyle: { display: 'flex', alignItems: 'center' },
        } as ColDef<SessionUser>]
      : []),
    {
      colId: 'status', headerName: 'Status', width: 130, sortable: true, filter: true, editable: false,
      valueGetter: (p) => (p.data?.is_active ? 'Active' : 'Inactive'),
      cellRenderer: statusCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: '__actions', headerName: '', width: 120, minWidth: 120, maxWidth: 120,
      pinned: 'right', sortable: false, filter: false, editable: false, resizable: false,
      cellRenderer: actionsCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
    },
  ], [nameCellRenderer, branchCellRenderer, managerCellRenderer, statusCellRenderer, actionsCellRenderer]);

  // Flex columns can leave a leftover blank strip after the last column if the
  // grid's own width settles after AG Grid's initial measurement (e.g. sidebar
  // collapses, layout reflows post-hydration). Forcing a fit on ready + on any
  // container resize keeps columns filling the full width with no gap.
  const [gridApi, setGridApi] = useState<GridApi<SessionUser> | null>(null);
  const onGridReady = useCallback((params: GridReadyEvent<SessionUser>) => {
    params.api.sizeColumnsToFit();
    setGridApi(params.api);
  }, []);
  const onGridSizeChanged = useCallback((params: GridSizeChangedEvent<SessionUser>) => {
    params.api.sizeColumnsToFit();
  }, []);

  // rowData (below) stays a stable reference to `users` — filtering happens
  // through these external-filter hooks instead of by swapping rowData on
  // every keystroke/selection. Reassigning rowData that frequently while a
  // sort is active is what caused sort to look broken/reverted when filters
  // were applied; AG Grid's own filter+sort pipeline handles the combination
  // correctly as long as rowData itself doesn't churn.
  const isExternalFilterPresent = useCallback(
    () =>
      search.trim().length > 0 ||
      roleSelected.length > 0 ||
      statusSelected.length > 0 ||
      orgSelected.length > 0 ||
      managerSelected.length > 0,
    [search, roleSelected, statusSelected, orgSelected, managerSelected],
  );
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<SessionUser>) => (node.data ? matchesFilters(node.data) : false),
    [matchesFilters],
  );
  useEffect(() => {
    gridApi?.onFilterChanged();
  }, [gridApi, search, roleSelected, statusSelected, orgSelected, managerSelected]);

  // Shared across every grid in the platform — case/accent-insensitive column
  // filtering lives in @platform/ui-kit/grid, not in a per-file literal.
  const defaultColDef: ColDef = GRID_DEFAULT_COL_DEF;

  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-sm text-[#64748B]">
        No team members found.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      {/* items-end, and the search box carries its own label: every MultiSelect
          is a label over a 34px trigger, so a bare input in this row sat half a
          label-height above the dropdowns whatever the alignment. */}
      <div className="flex flex-wrap items-end gap-2 border-b border-[#F1F5F9] p-3 sm:p-4">
        <div className="min-w-[200px] flex-1">
          <FilterField label="Search">
            <input
              type="search"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
            />
          </FilterField>
        </div>
        <MultiSelect
          label="Role"
          placeholder="All roles"
          options={roleOptions}
          selected={roleSelected}
          onChange={setRoleSelected}
        />
        <MultiSelect
          label="Status"
          placeholder="All statuses"
          options={STATUS_OPTIONS}
          selected={statusSelected}
          onChange={setStatusSelected}
        />
        {showCrossOrgFilters && (
          <>
            <MultiSelect
              label="Branch"
              placeholder="All branches"
              options={orgOptions}
              selected={orgSelected}
              onChange={setOrgSelected}
            />
            <MultiSelect
              label="Manager"
              placeholder="All managers"
              options={managerOptions}
              selected={managerSelected}
              onChange={setManagerSelected}
            />
          </>
        )}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <span className="text-xs text-[#64748B]">
            {filtered.length} of {users.length}
          </span>
          {/* Exports what the filters left, not the whole roster — the count beside
              it is the promise the file has to keep. */}
          <DownloadButton onExport={exportUsers} rowCount={filtered.length} />
        </div>
      </div>

      {isMobile ? (
        <ul className="divide-y divide-[#F1F5F9]">
          {filtered.map((u) => (
            <li key={u.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#0F172A]">
                    {displayName(u) || '—'}
                    {u.id === currentUserId && (
                      <span className="ml-2 text-[10px] font-semibold uppercase text-[#0b6cbf]">(you)</span>
                    )}
                  </p>
                  {u.role_label && <p className="text-[10px] text-[#94A3B8]">{u.role_label}</p>}
                  <p className="truncate text-xs text-[#475569]">{u.email}</p>
                </div>
                {canEditRow(u) ? (
                  <button
                    type="button"
                    onClick={() => onEdit(u)}
                    className="shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569]"
                  >
                    Edit
                  </button>
                ) : (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#94A3B8]">
                    View only
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <UserStatusBadge active={u.is_active} />
                {branchesOf(u).length > 0 && (
                  <span className="text-[11px] text-[#475569]" title={branchesOf(u).map((b) => b.org_name).join(', ')}>
                    {branchesOf(u)[0]!.org_name}
                    {branchesOf(u).length > 1 && ` +${branchesOf(u).length - 1}`}
                  </span>
                )}
                {u.manager_name ? (
                  <span className="text-[11px] text-[#475569]">↑ {u.manager_name}</span>
                ) : (
                  <span className="text-[11px] italic text-[#94A3B8]">No manager</span>
                )}
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-xs text-[#64748B]">
              No users match the filters.
            </li>
          )}
        </ul>
      ) : (
        <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
          <AgGridReact<SessionUser>
            rowData={users}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            isExternalFilterPresent={isExternalFilterPresent}
            doesExternalFilterPass={doesExternalFilterPass}
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
            overlayNoRowsTemplate="No users match the filters."
          />
        </div>
      )}
    </div>
  );
}
