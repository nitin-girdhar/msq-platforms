import { redirect } from 'next/navigation';
import { can, CAPABILITY } from '@platform/rbac';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import type { TenantBrandingView } from '@/src/lib/api/client';
import LoadError from '@/components/common/LoadError';
import BrandingSettings from '@/components/branding/BrandingSettings';

export const dynamic = 'force-dynamic';

// Settings → Branding: the session tenant's colours/font (while Super Admin
// has not locked them), terms and menu labels/icons, plus a read-only view of
// the Super Admin-owned logos, product names and login link. The server
// re-checks admin.branding.view / .manage and scopes to the session tenant.
export default async function BrandingPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session, cookieHeader } = result;

  if (!can(session, CAPABILITY.ADMIN_BRANDING_VIEW)) {
    return <LoadError title="Branding" status={403} />;
  }

  const res = await fetch(`${GATEWAY_URL}/tenant/branding`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
  if (!res.ok) {
    console.error(`[branding] GET ${GATEWAY_URL}/tenant/branding failed: ${res.status} ${res.statusText}`);
    return <LoadError title="Branding" status={res.status} />;
  }
  const body = (await res.json()) as { data: TenantBrandingView };

  return <BrandingSettings initial={body.data} canManage={can(session, CAPABILITY.ADMIN_BRANDING_MANAGE)} />;
}
