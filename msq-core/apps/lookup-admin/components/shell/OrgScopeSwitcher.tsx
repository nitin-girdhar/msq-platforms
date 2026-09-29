'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SearchableSelect } from '@platform/ui-kit';
import { ORG_COOKIE, type OrgOption } from '@/src/lib/tenant-cookie';

interface Props {
  orgs: OrgOption[];
  selectedTenantId?: string | undefined;
  selectedOrgId?: string | undefined;
}

const ONE_YEAR = 60 * 60 * 24 * 365;

// Second-level scope for `scope: 'org'` tables (Designations, …), one rung
// below TenantScopeSwitcher: same cookie + router.refresh() shape, filtered to
// the orgs under the currently selected tenant. Disabled with no tenant chosen
// — there is nothing to filter to, and TenantScopeSwitcher clears this cookie
// on every tenant change so a stale cross-tenant org can never be submitted.
export default function OrgScopeSwitcher({ orgs, selectedTenantId, selectedOrgId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const options = selectedTenantId ? orgs.filter((o) => o.tenant_id === selectedTenantId) : [];

  const handleChange = (value: string) => {
    document.cookie = value
      ? `${ORG_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
      : `${ORG_COOKIE}=; path=/; max-age=0; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
      <span className="hidden text-xs font-semibold text-[#64748B] sm:block">Org</span>
      {/* Type-to-filter for the same reason as the tenant control, and more
          acutely: a large tenant's branch list is the longest dropdown in the
          app. */}
      <SearchableSelect
        ariaLabel="Org scope"
        value={selectedTenantId ? (selectedOrgId ?? '') : ''}
        onChange={handleChange}
        options={options.map((o) => ({ id: o.id, label: o.name }))}
        emptyLabel={selectedTenantId ? '— All / select org —' : '— Select a tenant first —'}
        disabled={pending || !selectedTenantId}
        className="w-full sm:w-[200px]"
      />
    </div>
  );
}
