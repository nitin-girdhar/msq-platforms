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
  tenantScoped?: boolean | undefined;
  // Set app-wide by the navbar tenant switcher (dashboard/layout.tsx); this
  // screen consumes it, it does not pick it.
  selectedTenantId?: string | undefined;
}

export default function LookupTableShell({
  table,
  config,
  rows,
  tenantScoped,
  selectedTenantId,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LookupRow | null>(null);

  const typedRows = rows as LookupRow[];

  // Two ways a table needs a tenant before anything can be created: the rows
  // are tenant-scoped, or the row carries its own tenant_id column (e.g.
  // Organizations). Both now take that tenant from the navbar, so both need
  // one chosen before the New form can produce a valid row.
  const needsTenant = Boolean(tenantScoped) || config.fields.some((f) => f.key === 'tenant_id');
  const canCreate = !needsTenant || Boolean(selectedTenantId);

  // Two different uses of the same tenant, kept apart deliberately:
  //  - requestTenantId scopes the write itself, and must stay undefined for
  //    global tables — the backend 400s a tenant_id it doesn't expect.
  //  - selectedTenantId still seeds a form's own `tenant_id` COLUMN (e.g.
  //    Organizations), which is a value on the row, not a request scope.
  const requestTenantId = tenantScoped ? selectedTenantId : undefined;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/dashboard/m/${config.module}`} className="text-xs font-semibold text-[#0b6cbf] hover:underline">
            ← Back
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">{config.title}</h1>
          <p className="mt-1 text-xs text-[#64748B]">{typedRows.length} total · {config.description}</p>
        </div>
        {canCreate ? (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            New
          </Button>
        ) : !tenantScoped ? (
          // Rows still list fine across tenants here; only creating one needs a
          // tenant. Say why the button is gone instead of just hiding it.
          <p className="text-xs text-[#94A3B8]">Pick a tenant in the top bar to add one.</p>
        ) : null}
      </div>

      {tenantScoped && !selectedTenantId ? (
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Pick a tenant in the top bar to manage this table.
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
      />

      {editTarget && (
        <EditLookupModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          table={table}
          config={config}
          row={editTarget}
          tenantId={requestTenantId}
        />
      )}
    </div>
  );
}
