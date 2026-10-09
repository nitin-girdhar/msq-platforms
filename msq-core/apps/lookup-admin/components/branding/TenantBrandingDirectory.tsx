'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageBody, PageHeader } from '@platform/ui-kit';

export interface BrandingTenant {
  id: string;
  name: string;
  active: boolean;
}

type Filter = 'all' | 'active' | 'inactive';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

// Tenant picker for branding. Search and the Active/Inactive chips filter the
// list already loaded by the page; nothing here calls the API.
export default function TenantBrandingDirectory({ tenants }: { tenants: BrandingTenant[] }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(
    () => ({
      all: tenants.length,
      active: tenants.filter((t) => t.active).length,
      inactive: tenants.filter((t) => !t.active).length,
    }),
    [tenants],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenants.filter(
      (t) =>
        (filter === 'all' || (filter === 'active' ? t.active : !t.active)) &&
        (!q || t.name.toLowerCase().includes(q)),
    );
  }, [tenants, search, filter]);

  return (
    <>
      <PageHeader title="Tenant branding" subtitle="Per-tenant branding" info="Logos, product names, company colours and the login link, per tenant." />
      <PageBody dense>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tenant name…"
            aria-label="Search tenants"
            className="min-h-[2.75rem] min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none sm:min-h-0 sm:max-w-sm"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter tenants">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`min-h-[2.75rem] rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
                  filter === f.id
                    ? 'border-primary bg-primary-fixed text-primary'
                    : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {f.label} ({counts[f.id]})
              </button>
            ))}
          </div>
        </div>

        <ul className="flex flex-col divide-y divide-outline-variant/60 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          {visible.map((t) => (
            <li key={t.id}>
              <Link
                href={`/dashboard/tenants/${t.id}/branding`}
                className="flex min-h-[2.75rem] items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-container-low"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-sm font-bold text-primary">
                    {t.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate text-body-md font-semibold text-on-surface">{t.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-label-md">
                  {!t.active && <span className="rounded-full bg-surface-container px-2 py-0.5 text-on-surface-variant">Inactive</span>}
                  <span className="text-primary">Manage branding →</span>
                </span>
              </Link>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="px-4 py-6 text-center text-body-sm text-outline">
              {tenants.length === 0 ? 'No tenants.' : 'No tenants match.'}
            </li>
          )}
        </ul>
        <p className="text-xs text-on-surface-variant">{visible.length} of {tenants.length} tenants</p>
      </PageBody>
    </>
  );
}
