'use client';

import { useRouter, usePathname } from 'next/navigation';

interface TenantOption {
  id: string;
  name: string;
}

interface Props {
  tenants: TenantOption[];
  selectedTenantId?: string | undefined;
}

// Advisory-only tenant picker for tenant-scoped lookup tables. Driven by the
// URL's `tenant_id` search param so the server component page.tsx re-fetches
// rows for the chosen tenant on change; the real scoping/authorization check
// happens server-side (required `tenant_id` query param + RANKS.SUPER_ADMIN
// gate on the admin-service routes), not here.
export default function TenantSelector({ tenants, selectedTenantId }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const handleChange = (value: string) => {
    router.push(value ? `${pathname}?tenant_id=${value}` : pathname);
  };

  return (
    <div className="flex flex-col gap-1.5 sm:w-72">
      <label htmlFor="tenant-selector" className="text-xs font-semibold text-[#0F172A]">
        Tenant
      </label>
      <select
        id="tenant-selector"
        value={selectedTenantId ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
      >
        <option value="">— Select a tenant —</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}
