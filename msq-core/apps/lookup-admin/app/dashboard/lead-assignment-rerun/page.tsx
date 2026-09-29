import Link from 'next/link';
import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId } from '@/src/lib/tenant-scope';
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
      <div className="space-y-4 p-4 sm:p-6">
        <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to LMS
        </Link>
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Pick a tenant in the top bar to re-run auto-assignment.
        </p>
      </div>
    );
  }

  // Keyed by tenant so switching tenant drops the previous tenant's preview.
  return <RerunAssignmentClient key={selectedTenantId} tenantId={selectedTenantId} />;
}
