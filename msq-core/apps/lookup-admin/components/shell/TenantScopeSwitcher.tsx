'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
// From tenant-cookie, NOT tenant-scope — the latter imports `next/headers`,
// which cannot be pulled into a client component.
import { SearchableSelect } from '@platform/ui-kit';
import { TENANT_COOKIE, ORG_COOKIE, type TenantOption } from '@/src/lib/tenant-cookie';

interface Props {
  tenants: TenantOption[];
  selectedTenantId?: string | undefined;
}

const ONE_YEAR = 60 * 60 * 24 * 365;

// Navbar-level tenant scope for the whole admin app. Writing the cookie and
// calling router.refresh() re-renders the server components below with the new
// scope in place, so every tenant-scoped page follows this one control instead
// of carrying its own dropdown.
export default function TenantScopeSwitcher({ tenants, selectedTenantId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleChange = (value: string) => {
    document.cookie = value
      ? `${TENANT_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
      : `${TENANT_COOKIE}=; path=/; max-age=0; samesite=lax`;
    // A stale org from a different tenant must never survive a tenant switch —
    // clear it here rather than relying on OrgScopeSwitcher to notice.
    document.cookie = `${ORG_COOKIE}=; path=/; max-age=0; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs font-semibold text-[#64748B] sm:block">Tenant</span>
      {/* SearchableSelect, not a native <select>: this list grows with every
          tenant onboarded and a <select> cannot be typed into. Trigger keeps the
          Button `sm` scale (px-3 py-1.5 text-xs) so the navbar control sits at
          the same density as every other chrome button. */}
      <SearchableSelect
        ariaLabel="Tenant scope"
        value={selectedTenantId ?? ''}
        onChange={handleChange}
        options={tenants.map((t) => ({ id: t.id, label: t.name }))}
        emptyLabel="— All / select tenant —"
        disabled={pending}
        className="w-[200px]"
      />
    </div>
  );
}
