import Link from 'next/link';
import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId, getSelectedTenantName } from '@/src/lib/tenant-scope';
import { PageBody, PageHeader } from '@platform/ui-kit';
import MetaTabs from '@/components/meta-nav/MetaTabs';
import CapiOutboxClient from '@/components/capi-outbox/CapiOutboxClient';

export const dynamic = 'force-dynamic';

// Bespoke screen (1.79.0): the conversion events each stage change owes Meta. Tenant-scoped like Lead Pull —
// the administered tenant is the session's, sent as ?tenant_id= and RLS-pinned server-side. Gated by
// app/dashboard/layout.tsx, then per call by the gateway's superAdminGuard and the service's rank check.
export default async function CapiOutboxPage() {
  const result = await getServerSession();
  if (!result) return null;

  const tenantId = await getSelectedTenantId();
  if (!tenantId) {
    return (
      <>
        <PageHeader title="CAPI Outbox" subtitle="Conversion events owed to Meta" tabs={<MetaTabs />} />
        <PageBody dense>
          <Link href="/dashboard/m/lms" className="text-xs font-semibold text-primary hover:underline">
            ← Back to LMS
          </Link>
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            Pick a tenant in the top bar to see its CAPI outbox.
          </p>
        </PageBody>
      </>
    );
  }
  return <CapiOutboxClient tenantId={tenantId} tenantName={await getSelectedTenantName()} />;
}
