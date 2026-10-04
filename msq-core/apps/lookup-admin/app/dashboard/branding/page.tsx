import Link from 'next/link';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import LookupLoadError from '@/components/lookups/LookupLoadError';

export const dynamic = 'force-dynamic';

// Tenant Branding entry point: pick a tenant, then edit its branding at
// /dashboard/tenants/[id]/branding. Same tenant list the Tenants lookup reads.
export default async function TenantBrandingIndexPage() {
  const result = await getServerSession();
  if (!result) return null;

  const res = await fetch(`${GATEWAY_URL}/lookups/tenants`, {
    headers: { cookie: result.cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) return <LookupLoadError title="Tenant Branding" status={res.status} />;
  const body = (await res.json()) as { data: Array<Record<string, unknown>> };
  const tenants = body.data
    .filter((t) => t['is_deleted'] !== true)
    .map((t) => ({ id: String(t['id']), name: String(t['label'] ?? t['name'] ?? t['id']), active: t['is_active'] !== false }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-headline-md font-bold text-on-surface">Tenant branding</h1>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Logos, product names, company colours and the login link, per tenant.
        </p>
      </header>
      <ul className="flex flex-col divide-y divide-outline-variant/60 overflow-hidden rounded-xl bg-surface-container-lowest shadow-card">
        {tenants.map((t) => (
          <li key={t.id}>
            <Link
              href={`/dashboard/tenants/${t.id}/branding`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-container-low"
            >
              <span className="text-body-md font-semibold text-on-surface">{t.name}</span>
              <span className="flex items-center gap-3 text-label-md">
                {!t.active && <span className="rounded-full bg-surface-container px-2 py-0.5 text-on-surface-variant">Inactive</span>}
                <span className="text-primary">Manage branding →</span>
              </span>
            </Link>
          </li>
        ))}
        {tenants.length === 0 && <li className="px-4 py-6 text-center text-body-sm text-outline">No tenants.</li>}
      </ul>
    </div>
  );
}
