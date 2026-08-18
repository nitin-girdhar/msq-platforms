'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { LookupTableDef } from '@/src/lib/lookupTableConfig';
import { Button } from '@platform/ui-kit';
import LookupTable, { type LookupRow } from './LookupTable';
import CreateLookupModal from './CreateLookupModal';
import EditLookupModal from './EditLookupModal';

interface Props {
  table: string;
  config: LookupTableDef;
  rows: Record<string, unknown>[];
  // Set app-wide by the navbar tenant/org switchers (dashboard/layout.tsx);
  // this screen consumes them, it does not pick them.
  selectedTenantId?: string | undefined;
  selectedOrgId?: string | undefined;
}

export default function LookupTableShell({
  table,
  config,
  rows,
  selectedTenantId,
  selectedOrgId,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LookupRow | null>(null);

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
    ? 'Pick an org in the top bar to add one.'
    : 'Pick a tenant in the top bar to add one.';

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/dashboard/m/${config.module}`} className="text-xs font-semibold text-[#0b6cbf] hover:underline">
            ← Back
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">{config.title}</h1>
          <p className="mt-1 text-xs text-[#64748B]">{typedRows.length} total · {config.description}</p>
          {table === 'lead-stage' && (
            // ext.lead_stage_capi_event_map doesn't fit this shared grid (no
            // name/label/is_active — see lookupTableConfig.ts's note), so its
            // admin surface is a bespoke page linked from here instead.
            <Link href="/dashboard/lookups/lead-stage/capi-events" className="mt-1 inline-block text-xs font-semibold text-[#0b6cbf] hover:underline">
              Manage CAPI event mapping →
            </Link>
          )}
        </div>
        {canCreate ? (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            New
          </Button>
        ) : needsTenant ? (
          // Rows still list fine across tenants here; only creating one needs a
          // tenant/org. Say why the button is gone instead of just hiding it.
          <p className="text-xs text-[#94A3B8]">{scopeHint}</p>
        ) : null}
      </div>

      {scopeMissing ? (
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          {isOrgScoped ? 'Pick a tenant and an org in the top bar to manage this table.' : 'Pick a tenant in the top bar to manage this table.'}
        </p>
      ) : (
        <LookupTable config={config} rows={typedRows} onEdit={setEditTarget} />
      )}

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
    </div>
  );
}
