'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
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
    <div className="flex items-center gap-2">
      <label htmlFor="org-scope" className="hidden text-xs font-semibold text-[#64748B] sm:block">
        Org
      </label>
      <select
        id="org-scope"
        value={selectedTenantId ? (selectedOrgId ?? '') : ''}
        onChange={(e) => handleChange(e.target.value)}
        aria-busy={pending}
        className="max-w-[200px] rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:opacity-60"
        disabled={pending || !selectedTenantId}
      >
        <option value="">{selectedTenantId ? '— All / select org —' : '— Select a tenant first —'}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
