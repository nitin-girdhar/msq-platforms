import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import TenantBrandingDirectory from '@/components/branding/TenantBrandingDirectory';

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

  return <TenantBrandingDirectory tenants={tenants} />;
}
