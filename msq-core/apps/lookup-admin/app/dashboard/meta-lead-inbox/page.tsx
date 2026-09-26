import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId } from '@/src/lib/tenant-scope';
import MetaLeadInboxClient from '@/components/meta-lead-inbox/MetaLeadInboxClient';

export const dynamic = 'force-dynamic';

// Bespoke screen (1.51.0): webhook leads that did not land, for Retry once the
// cause is fixed. Works WITHOUT a selected tenant too — leads from pages mapped
// to nobody have no tenant yet, and triaging those is half the point.
export default async function MetaLeadInboxPage() {
  const result = await getServerSession();
  if (!result) return null;
  const selectedTenantId = await getSelectedTenantId();
  return <MetaLeadInboxClient key={selectedTenantId ?? 'none'} tenantId={selectedTenantId ?? null} />;
}
