import Link from 'next/link';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import { getSelectedTenantId } from '@/src/lib/tenant-scope';
import LeadPullClient from '@/components/lead-pull/LeadPullClient';
import type { MetaPageOption } from '@/src/lib/api/client';

export const dynamic = 'force-dynamic';

// Bespoke screen, same precedent as meta-mappings/meta-campaigns: this isn't a
// name/label/is_active catalog and the value of the screen (a pull's live
// progress, its delta summary, per-verdict drill-in) has no equivalent in the
// generic [table] grid.
//
// No guard here: app/dashboard/layout.tsx already gates the whole subtree with
// canOpenLookupAdmin(session). getServerSession() is still called, for the
// cookie header and to degrade cleanly if the session expired mid-request.
export default async function LeadPullPage() {
  const result = await getServerSession();
  if (!result) return null;
  const { cookieHeader } = result;

  const selectedTenantId = await getSelectedTenantId();

  if (!selectedTenantId) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to LMS
        </Link>
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Pick a tenant in the top bar to pull Meta leads.
        </p>
      </div>
    );
  }

  // Page discovery is best-effort, same as meta-mappings: /meta/pages spends
  // the tenant's stored Meta credentials on a live Graph API call and 404s when
  // there is no active integration. A missing page list must not take the
  // whole screen down — the filter form falls back to typed-in numeric page
  // ids, which the pull API accepts either way.
  let pages: MetaPageOption[] = [];
  let pagesUnavailable = false;
  try {
    const pagesRes = await fetch(
      `${GATEWAY_URL}/meta/pages?tenant_id=${encodeURIComponent(selectedTenantId)}`,
      { headers: { cookie: cookieHeader }, cache: 'no-store' },
    );
    if (pagesRes.ok) {
      const pagesBody = (await pagesRes.json()) as { data: MetaPageOption[] };
      pages = pagesBody.data;
    } else {
      pagesUnavailable = true;
    }
  } catch {
    pagesUnavailable = true;
  }

  // Reopen the tenant's current run, if any, so leaving this page mid-pull — or
  // before pressing Apply — no longer loses it. Best-effort like the page list:
  // a failure here only means the screen starts on an empty form.
  let initialRunId: string | null = null;
  try {
    const latestRes = await fetch(
      `${GATEWAY_URL}/meta/lead-pull/runs/latest?tenant_id=${encodeURIComponent(selectedTenantId)}`,
      { headers: { cookie: cookieHeader }, cache: 'no-store' },
    );
    if (latestRes.ok) {
      const latestBody = (await latestRes.json()) as { data: { run_id: string } | null };
      initialRunId = latestBody.data?.run_id ?? null;
    }
  } catch {
    initialRunId = null;
  }

  // Keyed by tenant: switching tenant in the navbar must drop the previous
  // tenant's run state rather than keep polling it under the new tenant id.
  return (
    <LeadPullClient
      key={selectedTenantId}
      tenantId={selectedTenantId}
      pages={pages}
      pagesUnavailable={pagesUnavailable}
      initialRunId={initialRunId}
    />
  );
}
