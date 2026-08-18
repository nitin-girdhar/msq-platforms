'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
// From tenant-cookie, NOT tenant-scope — the latter imports `next/headers`,
// which cannot be pulled into a client component.
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
      <label htmlFor="tenant-scope" className="hidden text-xs font-semibold text-[#64748B] sm:block">
        Tenant
      </label>
      <select
        id="tenant-scope"
        value={selectedTenantId ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        aria-busy={pending}
        // Pinned to the Button `sm` scale (px-3 py-1.5 text-xs) so the navbar
        // control sits at the same density as every other chrome button.
        className="max-w-[200px] rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:opacity-60"
        disabled={pending}
      >
        <option value="">— All / select tenant —</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}
