import Link from 'next/link';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import { getSelectedTenantId, getSelectedOrgId } from '@/src/lib/tenant-scope';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import MetaMappingsClient from '@/components/meta-mappings/MetaMappingsClient';
import type { MetaPageOrgMapRow, MetaPageOption } from '@/src/lib/api/client';

export const dynamic = 'force-dynamic';

const TITLE = 'Meta Page Mapping';

// Bespoke screen, deliberately outside lookupTableConfig.ts — same precedent
// the lead-stage CAPI events page documents. ext.meta_page_form_org_map is not
// a name/label/description/is_active catalog: its rows are a (page_id, form_id)
// routing key pointing at an org, with a nullable form_id whose NULL carries
// meaning (page-level catch-all). The generic [table] grid can express none of
// that, so this screen bypasses it and talks to /meta/page-org-map directly.
//
// No guard here: app/dashboard/layout.tsx already gates the whole subtree with
// canOpenLookupAdmin(session). getServerSession() is still called, for the
// cookie header and to degrade cleanly if the session expired mid-request.
export default async function MetaMappingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page_id?: string | string[] }>;
}) {
  const result = await getServerSession();
  if (!result) return null;
  const { cookieHeader } = result;

  // ?page_id= arrives from the lead-pull summary's unmapped_form links, so the
  // admin lands on the one page that needs a mapping. Accepted only as a single
  // numeric Meta id; anything else is ignored rather than filtering to nothing.
  const { page_id: rawPageId } = await searchParams;
  const pageIdFilter = typeof rawPageId === 'string' && /^\d+$/.test(rawPageId) ? rawPageId : undefined;

  const selectedTenantId = await getSelectedTenantId();
  // Optional and normally undefined — that is "all branches in this tenant",
  // not an error state. It narrows the grid; it never blocks it.
  const selectedOrgId = await getSelectedOrgId();

  if (!selectedTenantId) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to LMS
        </Link>
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Pick a tenant in the top bar to manage Meta page mapping.
        </p>
      </div>
    );
  }

  const mappingsRes = await fetch(
    `${GATEWAY_URL}/meta/page-org-map?tenant_id=${selectedTenantId}`,
    { headers: { cookie: cookieHeader }, cache: 'no-store' },
  );
  if (!mappingsRes.ok) return <LookupLoadError title={TITLE} status={mappingsRes.status} />;

  const mappingsBody = (await mappingsRes.json()) as { data: MetaPageOrgMapRow[] };

  // Page discovery is best-effort and must never take the screen down with it.
  // /meta/pages spends the tenant's stored Meta credentials on a live Graph API
  // call, so it 404s when the tenant has no active integration configured and
  // can fail outright when Meta is slow or the token has expired. Existing
  // mappings still need to be viewable and deactivatable in all three cases, so
  // a failure degrades the page picker to a raw-id input rather than rendering
  // LookupLoadError over rows that loaded perfectly well.
  let pages: MetaPageOption[] = [];
  let pagesUnavailable = false;
  try {
    const pagesRes = await fetch(
      `${GATEWAY_URL}/meta/pages?tenant_id=${selectedTenantId}`,
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

  return (
    <MetaMappingsClient
      tenantId={selectedTenantId}
      selectedOrgId={selectedOrgId}
      pageIdFilter={pageIdFilter}
      rows={mappingsBody.data}
      pages={pages}
      pagesUnavailable={pagesUnavailable}
    />
  );
}
