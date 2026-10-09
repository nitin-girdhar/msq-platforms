'use client';

import { useMemo, useState } from 'react';
import { PageBody, PageHeader } from '@platform/ui-kit';
import type { CatalogDriftRow } from '@/src/lib/api/client';

type Filter = 'all' | 'behind';

const isBehind = (c: CatalogDriftRow | undefined) =>
  !c || c.tenant_version === null || c.tenant_version < c.current_version;

const label = (c: CatalogDriftRow | undefined) => (c ? `v${c.tenant_version ?? '—'} / v${c.current_version}` : '—');

// Read-only drift report: desktop is the tenant x catalog matrix, phones get one
// card per tenant. Drift is computed from the rows the page already loaded.
export default function CatalogVersionsView({ rows }: { rows: CatalogDriftRow[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  const catalogKeys = useMemo(() => Array.from(new Set(rows.map((r) => r.catalog_key))).sort(), [rows]);
  const tenants = useMemo(() => {
    const ids = Array.from(new Set(rows.map((r) => r.tenant_id)));
    return ids
      .map((id) => ({ id, name: rows.find((r) => r.tenant_id === id)?.tenant_name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const cell = (tenantId: string, key: string) => rows.find((r) => r.tenant_id === tenantId && r.catalog_key === key);
  const behindFor = (tenantId: string) => catalogKeys.filter((k) => isBehind(cell(tenantId, k))).length;

  const totalCells = tenants.length * catalogKeys.length;
  const behindCells = tenants.reduce((n, t) => n + behindFor(t.id), 0);
  const behindTenants = tenants.filter((t) => behindFor(t.id) > 0);
  const shown = filter === 'behind' ? behindTenants : tenants;

  return (
    <>
      <PageHeader
        title="Catalog Versions"
        subtitle={`${tenants.length} tenant${tenants.length === 1 ? '' : 's'} · ${behindCells} of ${totalCells} catalogs behind current`}
        info="Each cell is a tenant's seeded version over the current default. A red cell is behind current or was never seeded. That is not necessarily a problem, since a tenant may have customised past what a re-seed would restore, but check before assuming every tenant has the latest defaults."
      />
      <PageBody dense>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter tenants">
          {([['all', `All tenants (${tenants.length})`], ['behind', `Behind current only (${behindTenants.length})`]] as const).map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`min-h-[2.75rem] rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
                filter === id
                  ? 'border-primary bg-primary-fixed text-primary'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {text}
            </button>
          ))}
        </div>

        {/* Desktop matrix */}
        <div className="hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold text-on-surface-variant">
              <tr>
                <th className="sticky left-0 bg-surface-container-low px-4 py-2.5">Tenant</th>
                {catalogKeys.map((key) => (
                  <th key={key} className="whitespace-nowrap px-4 py-2.5">{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="border-b border-outline-variant last:border-0">
                  <td className="sticky left-0 bg-surface-container-lowest px-4 py-2.5 font-medium text-on-surface">{t.name}</td>
                  {catalogKeys.map((key) => {
                    const c = cell(t.id, key);
                    return (
                      <td key={key} className={`whitespace-nowrap px-4 py-2.5 font-mono text-xs ${isBehind(c) ? 'font-semibold text-on-status-overdue-container' : 'text-on-surface'}`}>
                        {label(c)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={catalogKeys.length + 1} className="px-4 py-6 text-center text-xs text-outline">
                    {tenants.length === 0 ? 'No tenants.' : 'Every tenant is up to date.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Phone: one card per tenant */}
        <div className="space-y-3 md:hidden">
          {shown.map((t) => {
            const behind = behindFor(t.id);
            return (
              <section key={t.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="truncate text-sm font-semibold text-on-surface">{t.name}</h2>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${behind ? 'bg-status-overdue-container text-on-status-overdue-container' : 'bg-status-success-container text-on-status-success-container'}`}>
                    {behind ? `${behind} behind` : 'Up to date'}
                  </span>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {catalogKeys.map((key) => {
                    const c = cell(t.id, key);
                    return (
                      <li key={key} className={`rounded-lg px-2 py-1 font-mono text-[0.6875rem] ${isBehind(c) ? 'bg-status-overdue-container text-on-status-overdue-container' : 'bg-surface-container text-on-surface-variant'}`}>
                        {key} <strong>{label(c)}</strong>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {shown.length === 0 && <p className="py-6 text-center text-xs text-outline">{tenants.length === 0 ? 'No tenants.' : 'Every tenant is up to date.'}</p>}
        </div>
      </PageBody>
    </>
  );
}
