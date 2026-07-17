'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { LookupTableDef } from '@/src/lib/lookupTableConfig';
import LookupTable, { type LookupRow } from './LookupTable';
import CreateLookupModal from './CreateLookupModal';
import EditLookupModal from './EditLookupModal';

interface Props {
  table: string;
  config: LookupTableDef;
  rows: Record<string, unknown>[];
}

export default function LookupTableShell({ table, config, rows }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LookupRow | null>(null);

  const typedRows = rows as LookupRow[];

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
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#095699]"
        >
          New
        </button>
      </div>

      <LookupTable config={config} rows={typedRows} onEdit={setEditTarget} />

      <CreateLookupModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        table={table}
        config={config}
      />

      {editTarget && (
        <EditLookupModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          table={table}
          config={config}
          row={editTarget}
        />
      )}
    </div>
  );
}
