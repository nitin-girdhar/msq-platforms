import Link from 'next/link';
import { PageBody, PageHeader } from '@platform/ui-kit';
import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId, getSelectedTenantName } from '@/src/lib/tenant-scope';
import RerunAssignmentClient from '@/components/lead-assignment-rerun/RerunAssignmentClient';

export const dynamic = 'force-dynamic';

// Bespoke screen, same precedent as meta-mappings/lead-pull: an action, not a
// name/label/is_active catalog, so it bypasses the generic [table] grid.
//
// No guard here: app/dashboard/layout.tsx already gates the whole subtree with
// canOpenLookupAdmin(session). getServerSession() is still called so an expired
// session degrades cleanly.
export default async function LeadAssignmentRerunPage() {
  const result = await getServerSession();
  if (!result) return null;

  const selectedTenantId = await getSelectedTenantId();

  if (!selectedTenantId) {
    return (
      <>
        <PageHeader title="Re-run Auto-Assignment" subtitle="Assign leads that arrived unassigned" />
        <PageBody>
          <Link href="/dashboard/m/lms" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline sm:min-h-0">
            ← Back to LMS
          </Link>
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            Pick a tenant in the top bar to re-run auto-assignment.
          </p>
        </PageBody>
      </>
    );
  }

  // Keyed by tenant so switching tenant drops the previous tenant's preview.
  return (
    <RerunAssignmentClient
      key={selectedTenantId}
      tenantId={selectedTenantId}
      tenantName={await getSelectedTenantName()}
    />
  );
}
