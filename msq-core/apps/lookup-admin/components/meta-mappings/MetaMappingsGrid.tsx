'use client';

import '@platform/ui-kit/ag-grid.css';
import { useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, GridSizeChangedEvent, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { GRID_DEFAULT_COL_DEF, scalePx } from '@platform/ui-kit/grid';
import type { MetaPageHealthRow, MetaPageOrgMapRow, MetaPlatform } from '@/src/lib/api/client';

ModuleRegistry.registerModules([AllCommunityModule]);

const PLATFORM_LABELS: Record<MetaPlatform, string> = {
  fb: 'Facebook',
  ig: 'Instagram',
  wa: 'WhatsApp',
};

const PLATFORM_CLASSES: Record<MetaPlatform, string> = {
  fb: 'bg-status-info-container text-primary',
  ig: 'bg-surface-container text-on-surface-variant',
  wa: 'bg-status-success-container text-on-status-success-container',
};

// The whole point of the screen: a NULL form_id is a page-level catch-all, and
// it has to be legible as such at a glance rather than as an empty cell that
// reads like missing data.
const PAGE_LEVEL_LABEL = 'All forms (page-level)';

import GridIconButton from '@/components/meta-shared/GridIconButton';

interface Props {
  rows: MetaPageOrgMapRow[];
  pageNames: Record<string, string>;
  orgNames: Record<string, string>;
  onEdit: (row: MetaPageOrgMapRow) => void;
  // 1.70.0: last stored token / subscription check per page_id.
  health: Record<string, MetaPageHealthRow>;
  // 1.79.0: subscribe the app to this page's leadgen webhook (Meta delivers leads only for subscribed pages).
  onSubscribe?: ((pageId: string) => void) | undefined;
  subscribingPageId?: string | null | undefined;
}

// What the Token health cell says, and its colour. 'Not checked' is its own state: a page
// nobody has validated yet is unknown, not healthy.
export function healthView(h: MetaPageHealthRow | undefined): { label: string; className: string; title: string } {
  if (!h) return { label: 'Not checked', className: 'bg-surface-container text-on-surface-variant', title: 'Press Validate Page Tokens to check' };
  const when = `Checked ${new Date(h.checked_at).toLocaleString()}`;
  // The page works end to end only when the token is good, the app is subscribed AND the leads can actually be read.
  if (h.token_status === 'ok' && h.is_subscribed && h.leads_access_ok === false) return { label: 'No leads access', className: 'bg-error-container text-on-error-container', title: `${h.error_text ?? 'The page is shared but its leads cannot be read'} ${when}`.trim() };
  if (h.token_status === 'ok' && h.is_subscribed && h.leads_access_ok === true) return { label: 'Healthy', className: 'bg-status-success-container text-on-status-success-container', title: `Token, webhook subscription and leads access all OK. ${when}` };
  if (h.token_status === 'ok' && h.is_subscribed) return { label: 'Subscribed', className: 'bg-status-success-container text-on-status-success-container', title: when };
  if (h.token_status === 'ok') return { label: 'Not subscribed', className: 'bg-status-due-container text-on-status-due-container', title: `${h.error_text ?? ''} ${when}`.trim() };
  if (h.token_status === 'expired') return { label: 'Token expired', className: 'bg-error-container text-on-error-container', title: `${h.error_text ?? ''} ${when}`.trim() };
  if (h.token_status === 'missing') return { label: 'No page token', className: 'bg-error-container text-on-error-container', title: `${h.error_text ?? ''} ${when}`.trim() };
  return { label: 'Check failed', className: 'bg-status-due-container text-on-status-due-container', title: `${h.error_text ?? ''} ${when}`.trim() };
}

function platformLabel(platform: MetaPlatform | undefined): string {
  return platform ? PLATFORM_LABELS[platform] ?? platform : '';
}

function formatSyncedAt(value: string | null | undefined): string {
  if (!value) return 'Never';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
}

export default function MetaMappingsGrid({ rows, pageNames, orgNames, onEdit, health, onSubscribe, subscribingPageId }: Props) {
  const pageCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    const id = p.data?.page_id ?? '';
    const name = pageNames[id];
    return (
      <div className="flex flex-col justify-center leading-tight">
        <p className="truncate text-sm font-semibold leading-tight text-on-surface">{name ?? id}</p>
        {name ? <p className="truncate font-mono text-[0.6875rem] leading-tight text-on-surface-variant">{id}</p> : null}
      </div>
    );
  }, [pageNames]);

  const platformCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    const platform = p.data?.platform;
    if (!platform) return null;
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PLATFORM_CLASSES[platform] ?? 'bg-surface-container text-on-surface-variant'}`}>
        {platformLabel(platform)}
      </span>
    );
  }, []);

  const statusCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    if (!p.data) return null;
    return p.data.is_active ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-status-success-container px-2 py-0.5 text-xs font-medium text-on-status-success-container">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" />
        Active
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-2 py-0.5 text-xs font-medium text-on-surface-variant">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-on-surface-variant" />
        Inactive
      </span>
    );
  }, []);

  const formCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    const row = p.data;
    if (!row) return null;
    if (row.form_id === null) {
      return (
        <span className="inline-flex items-center rounded-full bg-status-due-container px-2 py-0.5 text-xs font-medium text-on-status-due-container">
          {PAGE_LEVEL_LABEL}
        </span>
      );
    }
    return <span className="font-mono text-xs text-on-surface">{row.form_id}</span>;
  }, []);

  const healthCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    if (!p.data) return null;
    const v = healthView(health[p.data.page_id]);
    return (
      <span title={v.title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${v.className}`}>
        {v.label}
      </span>
    );
  }, [health]);

  const actionsCellRenderer = useCallback((p: ICellRendererParams<MetaPageOrgMapRow>) => {
    const row = p.data;
    if (!row) return null;
    const h = health[row.page_id];
    const canSubscribe = Boolean(onSubscribe) && h?.token_status === 'ok' && h.is_subscribed === false;
    return (
      <span className="inline-flex items-center gap-1.5">
        {canSubscribe && (
          <GridIconButton
            icon="subscribe"
            label={subscribingPageId === row.page_id ? 'Subscribing…' : 'Subscribe the app to this page'}
            onClick={() => onSubscribe?.(row.page_id)}
            disabled={subscribingPageId === row.page_id}
            primary
          />
        )}
        <GridIconButton icon="edit" label="Edit mapping" onClick={() => onEdit(row)} />
      </span>
    );
  }, [onEdit, onSubscribe, subscribingPageId, health]);

  // Every cellRenderer that draws a LABEL gets a valueGetter returning that
  // same label — the rule documented in @platform/ui-kit/grid's gridDefaults.
  // Without it the column filter and the sort run against the raw field
  // ('fb', null, true) while the user is reading 'Facebook' /
  // 'All forms (page-level)' / 'Active', so typing the visible text into the
  // filter matches nothing and the sort order looks arbitrary.
  const columnDefs = useMemo((): ColDef<MetaPageOrgMapRow>[] => [
    {
      colId: 'page', headerName: 'Page', flex: 2, minWidth: 150, sortable: true, filter: true,
      valueGetter: (p) => {
        const id = p.data?.page_id ?? '';
        const name = pageNames[id];
        return name ? `${name} (${id})` : id;
      },
      cellRenderer: pageCellRenderer,
    },
    {
      colId: 'form_id', headerName: 'Form', width: 170, minWidth: 130, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.form_id === null ? PAGE_LEVEL_LABEL : p.data?.form_id ?? ''),
      cellRenderer: formCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'org', headerName: 'Branch', flex: 1.5, minWidth: 130, sortable: true, filter: true,
      valueGetter: (p) => orgNames[p.data?.org_id ?? ''] ?? p.data?.org_id ?? '',
    },
    {
      // 1.51.0: the page/form fallback type — used when neither a confirmed
      // campaign nor a rule types the lead, and for organic leads.
      colId: 'default_type', headerName: 'Default type', width: 120, minWidth: 100, sortable: true, filter: true,
      valueGetter: (p) => p.data?.default_campaign_type_label ?? '—',
    },
    {
      colId: 'platform', headerName: 'Platform', width: 105, minWidth: 95, sortable: true, filter: true,
      valueGetter: (p) => platformLabel(p.data?.platform),
      cellRenderer: platformCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      // 1.70.0: the last "Validate Page Tokens" result for this row's page.
      colId: 'token_health', headerName: 'Health', width: 130, minWidth: 120, sortable: true, filter: true,
      valueGetter: (p) => healthView(health[p.data?.page_id ?? '']).label,
      cellRenderer: healthCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'is_active', headerName: 'Status', width: 100, minWidth: 90, sortable: true, filter: true,
      valueGetter: (p) => (p.data?.is_active ? 'Active' : 'Inactive'),
      cellRenderer: statusCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
    {
      colId: 'last_synced_at', headerName: 'Last lead', width: 150, minWidth: 120, sortable: true, filter: true,
      valueGetter: (p) => formatSyncedAt(p.data?.last_synced_at),
    },
    {
      colId: '__actions', headerName: '', width: 84, minWidth: 84, maxWidth: 84,
      pinned: 'right', sortable: false, filter: false, resizable: false,
      cellRenderer: actionsCellRenderer,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
    },
  ], [pageNames, orgNames, health, pageCellRenderer, formCellRenderer, platformCellRenderer, statusCellRenderer, healthCellRenderer, actionsCellRenderer]);

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
    <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
        <AgGridReact<MetaPageOrgMapRow>
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
          overlayNoRowsTemplate="No Meta page mappings for this scope."
        />
      </div>
    </div>
  );
}
