import { getServerSession } from '@/src/lib/server-session';
import MetaAdAccountsClient from '@/components/meta-ad-accounts/MetaAdAccountsClient';

export const dynamic = 'force-dynamic';

// Bespoke screen (1.51.0). PLATFORM-level — no tenant picker: the shared Meta
// integration's ad accounts carry campaigns for many tenants, and each campaign
// is attributed to a tenant by its promoted pages. Gated by
// app/dashboard/layout.tsx and, per call, by the gateway's superAdminGuard plus
// meta-conversion-api's rank check.
export default async function MetaAdAccountsPage() {
  const result = await getServerSession();
  if (!result) return null;
  return <MetaAdAccountsClient />;
}
