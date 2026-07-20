'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { LookupTableDef } from '@/src/lib/lookupTableConfig';
import LookupTable, { type LookupRow } from './LookupTable';
import CreateLookupModal from './CreateLookupModal';
import EditLookupModal from './EditLookupModal';
import TenantSelector from './TenantSelector';

interface TenantOption {
  id: string;
  name: string;
}

interface Props {
  table: string;
  config: LookupTableDef;
  rows: Record<string, unknown>[];
  tenantScoped?: boolean | undefined;
  tenants?: TenantOption[];
  selectedTenantId?: string | undefined;
}

export default function LookupTableShell({
  table,
  config,
  rows,
  tenantScoped,
  tenants = [],
  selectedTenantId,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LookupRow | null>(null);

  const typedRows = rows as LookupRow[];
  const canCreate = !tenantScoped || Boolean(selectedTenantId);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
            ← All lookup tables
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">{config.title}</h1>
          <p className="mt-1 text-xs text-[#64748B]">{typedRows.length} total · {config.description}</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#095699]"
          >
            New
          </button>
        )}
      </div>

      {tenantScoped && <TenantSelector tenants={tenants} selectedTenantId={selectedTenantId} />}

      {tenantScoped && !selectedTenantId ? (
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Select a tenant to manage this table.
        </p>
      ) : (
        <LookupTable config={config} rows={typedRows} onEdit={setEditTarget} />
      )}

      <CreateLookupModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        table={table}
        config={config}
        tenantId={selectedTenantId}
      />

      {editTarget && (
        <EditLookupModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          table={table}
          config={config}
          row={editTarget}
          tenantId={selectedTenantId}
        />
      )}
    </div>
  );
}
