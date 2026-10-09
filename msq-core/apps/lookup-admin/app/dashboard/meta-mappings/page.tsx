import Link from 'next/link';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import { getSelectedTenantId, getSelectedTenantName, getSelectedOrgId } from '@/src/lib/tenant-scope';
import { PageBody, PageHeader } from '@platform/ui-kit';
import MetaTabs from '@/components/meta-nav/MetaTabs';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import MetaMappingsClient from '@/components/meta-mappings/MetaMappingsClient';
import type { MetaPageOrgMapRow } from '@/src/lib/api/client';

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
      <>
        <PageHeader title="Meta Page & Branch Mapping" subtitle="Which branch every inbound Meta lead lands in" tabs={<MetaTabs />} />
        <PageBody dense>
          <Link href="/dashboard/m/lms" className="text-xs font-semibold text-primary hover:underline">
            ← Back to LMS
          </Link>
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            Pick a tenant in the top bar to manage Meta page mapping.
          </p>
        </PageBody>
      </>
    );
  }

  const mappingsRes = await fetch(
    `${GATEWAY_URL}/meta/page-org-map?tenant_id=${selectedTenantId}`,
    { headers: { cookie: cookieHeader }, cache: 'no-store' },
  );
  if (!mappingsRes.ok) return <LookupLoadError title={TITLE} status={mappingsRes.status} />;

  const mappingsBody = (await mappingsRes.json()) as { data: MetaPageOrgMapRow[] };

  // Page discovery (/meta/pages) is a live Graph call against the tenant's Meta
  // credentials, so it is NOT fetched here: this server component re-runs on every
  // router.refresh() after a save, which re-spent that call each time. The client
  // loads it once on mount and degrades to a raw-id picker if it fails.

  return (
    <MetaMappingsClient
      tenantId={selectedTenantId}
      tenantName={await getSelectedTenantName()}
      selectedOrgId={selectedOrgId}
      pageIdFilter={pageIdFilter}
      rows={mappingsBody.data}
    />
  );
}
