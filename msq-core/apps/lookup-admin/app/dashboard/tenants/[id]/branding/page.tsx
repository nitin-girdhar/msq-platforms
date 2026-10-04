import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import TenantBrandingClient from '@/components/branding/TenantBrandingClient';
import type { SaBrandingView } from '@/src/lib/api/client';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Super Admin → tenant branding: logos/icons, product names, company theme +
// the "allow tenant admin changes" lock, and the rotatable login link. The
// identity-service route is rank-gated to super admin; this console's own
// guard (dashboard layout) already keeps everyone else out.
export default async function TenantBrandingPage({ params }: PageProps) {
  const { id } = await params;
  const result = await getServerSession();
  if (!result) return null;

  const res = await fetch(`${GATEWAY_URL}/sa/tenants/${encodeURIComponent(id)}/branding`, {
    headers: { cookie: result.cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) return <LookupLoadError title="Tenant Branding" status={res.status} />;
  const body = (await res.json()) as { data: SaBrandingView };

  return <TenantBrandingClient tenantId={id} initial={body.data} />;
}
