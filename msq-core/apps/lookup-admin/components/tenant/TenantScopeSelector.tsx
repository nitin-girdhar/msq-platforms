'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { TENANT_COOKIE } from '@/src/lib/tenant-cookie';

// The ONE tenant picker for the whole admin module, rendered in the dashboard
// header. Writing the choice to a cookie (rather than a per-page `?tenant_id=`)
// is what makes it stick across navigation: every server component downstream
// reads it via getSelectedTenantId(), so a single selection scopes every fetch.
//
// Not httpOnly by design — this is an advisory UI preference the client itself
// sets. Authorization is unchanged and entirely server-side.
export default function TenantScopeSelector({
  tenants,
  selectedTenantId,
}: {
  tenants: Array<{ id: string; name: string }>;
  selectedTenantId: string | undefined;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (value: string) => {
    // max-age 0 expires the cookie when the admin clears the selection.
    document.cookie = value
      ? `${TENANT_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
      : `${TENANT_COOKIE}=; path=/; max-age=0; samesite=lax`;
    // refresh() re-runs the server components on the current route against the
    // new cookie, so the visible table reloads for the chosen tenant without a
    // full navigation and without putting tenant_id back in the URL.
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
        aria-busy={isPending}
        className="max-w-[12rem] rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:opacity-60"
        disabled={isPending}
      >
        <option value="">— Select a tenant —</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}
