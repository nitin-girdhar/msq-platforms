import { getServerSession } from '@/src/lib/server-session';
import MetaConnectionClient from '@/components/meta-connection/MetaConnectionClient';

export const dynamic = 'force-dynamic';

// Bespoke screen (1.79.0). PLATFORM-level, like Meta Ad Accounts: one Meta app and two system users serve
// every tenant, so there is no tenant picker. Gated by app/dashboard/layout.tsx, then per call by the
// gateway's superAdminGuard and meta-conversion-api's rank check. Secrets are write-only.
export default async function MetaConnectionPage() {
  const result = await getServerSession();
  if (!result) return null;
  return <MetaConnectionClient />;
}
