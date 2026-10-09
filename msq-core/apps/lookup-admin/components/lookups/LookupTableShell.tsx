'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { LookupTableDef } from '@/src/lib/lookupTableConfig';
import { Button, PageBody, PageHeader } from '@platform/ui-kit';
import LookupTable, { type LookupRow } from './LookupTable';
import CreateLookupModal from './CreateLookupModal';
import EditLookupModal from './EditLookupModal';

interface Props {
  table: string;
  config: LookupTableDef;
  rows: Record<string, unknown>[];
  // The session's tenant/branch (navbar switcher, via src/lib/tenant-scope.ts);
  // this screen consumes them, it does not pick them.
  selectedTenantId?: string | undefined;
  selectedOrgId?: string | undefined;
  // The tenant's NAME for the header chip. Absent on a scope: 'global' table,
  // whose rows are platform-wide and belong to no tenant.
  tenantName?: string | undefined;
}

type ChipId = 'all' | 'active' | 'inactive' | 'terminal' | 'followup';

export default function LookupTableShell({
  table,
  config,
  rows,
  selectedTenantId,
  selectedOrgId,
  tenantName,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LookupRow | null>(null);
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState<ChipId>('all');

  const typedRows = rows as LookupRow[];

  const isOrgScoped = config.scope === 'org';
  const isTenantScoped = config.scope === 'tenant';

  // Two ways a table needs a tenant before anything can be created: the rows
  // are tenant/org-scoped, or the row carries its own tenant_id column (e.g.
  // Organizations). All now take that tenant from the navbar, so all need
  // one chosen before the New form can produce a valid row. An org-scoped
  // table additionally needs the org.
  const needsTenant = isTenantScoped || isOrgScoped || config.fields.some((f) => f.key === 'tenant_id');
  const canCreate = (!needsTenant || Boolean(selectedTenantId)) && (!isOrgScoped || Boolean(selectedOrgId));

  // Two different uses of the same tenant, kept apart deliberately:
  //  - requestTenantId scopes the write itself, and must stay undefined for
  //    global tables — the backend 400s a tenant_id it doesn't expect. An
  //    org-scoped table needs it too: hr.designations has no tenant_id
  //    column, so the admin write RLS session is pinned from this query param
  //    instead (db_scripts/08_rls.sql's admin_tenant_config_policy).
  //  - selectedTenantId still seeds a form's own `tenant_id` COLUMN (e.g.
  //    Organizations), which is a value on the row, not a request scope.
  const requestTenantId = isTenantScoped || isOrgScoped ? selectedTenantId : undefined;

  const scopeMissing = isOrgScoped
    ? !selectedTenantId || !selectedOrgId
    : isTenantScoped && !selectedTenantId;

  const scopeHint = isOrgScoped && selectedTenantId && !selectedOrgId
    ? 'Pick a branch in the top bar to add one.'
    : 'Pick a tenant in the top bar to add one.';

  const isLeadStage = table === 'lead-stage';
  const chips: ReadonlyArray<{ id: ChipId; label: string }> = isLeadStage
    ? [{ id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'terminal', label: 'Terminal' }, { id: 'followup', label: 'Requires follow-up' }]
    : [{ id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' }];

  const matchesChip = (r: LookupRow, id: ChipId) =>
    id === 'all' ? true
    : id === 'active' ? r.is_active
    : id === 'inactive' ? !r.is_active
    : id === 'terminal' ? Boolean(r['is_terminated'])
    : Boolean(r['followup_required']);

  const chipCount = (id: ChipId) => typedRows.filter((r) => matchesChip(r, id)).length;

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return typedRows.filter(
      (r) =>
        matchesChip(r, chip) &&
        (!q || [r.name, r.label, r['description']].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedRows, search, chip]);

  return (
    <>
      <PageHeader
        title={config.title}
        scope={tenantName}
        subtitle={`${typedRows.length} total`}
        info={config.description}
        actions={
          <>
            <Link href={`/dashboard/m/${config.module}`} className="inline-flex min-h-[2.75rem] items-center px-1 text-xs font-semibold text-primary hover:underline sm:min-h-0">
              ← Back
            </Link>
            {isLeadStage && (
              // ext.lead_stage_capi_event_map doesn't fit this shared grid (no
              // name/label/is_active — see lookupTableConfig.ts's note), so its
              // admin surface is a bespoke page linked from here instead.
              <Link href="/dashboard/lookups/lead-stage/capi-events" className="inline-flex min-h-[2.75rem] items-center px-1 text-xs font-semibold text-primary hover:underline sm:min-h-0">
                Manage CAPI event mapping →
              </Link>
            )}
            {canCreate ? (
              <Button variant="primary" className="min-h-[2.75rem] sm:min-h-0" onClick={() => setCreateOpen(true)}>
                New
              </Button>
            ) : needsTenant ? (
              // Rows still list fine across tenants here; only creating one needs a
              // tenant/org. Say why the button is gone instead of just hiding it.
              <p className="text-xs text-outline">{scopeHint}</p>
            ) : null}
          </>
        }
      />
      <PageBody dense>
        {isLeadStage && !scopeMissing && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { k: 'Active stages', v: `${chipCount('active')} / ${typedRows.length}`, note: 'configured' },
              { k: 'Follow-up gates', v: String(chipCount('followup')), note: 'stages require a follow-up' },
              { k: 'Terminal states', v: String(chipCount('terminal')), note: 'stages end the lead' },
            ].map((c) => (
              <div key={c.k} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-on-surface-variant">{c.k}</p>
                <p className="mt-1 font-mono text-headline-md font-bold text-on-surface">{c.v}</p>
                <p className="text-xs text-on-surface-variant">{c.note}</p>
              </div>
            ))}
          </div>
        )}

        {scopeMissing ? (
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            {isOrgScoped ? 'Pick a branch in the top bar to manage this table (not All branches).' : 'Pick a tenant in the top bar to manage this table.'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code or description…"
                aria-label={`Search ${config.title}`}
                className="min-h-[2.75rem] min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none sm:min-h-0 sm:max-w-sm"
              />
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter rows">
                {chips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={chip === c.id}
                    onClick={() => setChip(c.id)}
                    className={`min-h-[2.75rem] rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
                      chip === c.id
                        ? 'border-primary bg-primary-fixed text-primary'
                        : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    {c.label} ({chipCount(c.id)})
                  </button>
                ))}
              </div>
            </div>
            <LookupTable config={config} rows={visibleRows} onEdit={setEditTarget} />
          </>
        )}
      </PageBody>

      <CreateLookupModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        table={table}
        config={config}
        tenantId={requestTenantId}
        scopeTenantId={selectedTenantId}
        orgId={isOrgScoped ? selectedOrgId : undefined}
      />

      {editTarget && (
        <EditLookupModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          table={table}
          config={config}
          row={editTarget}
          tenantId={requestTenantId}
          orgId={isOrgScoped ? selectedOrgId : undefined}
        />
      )}
    </>
  );
}
