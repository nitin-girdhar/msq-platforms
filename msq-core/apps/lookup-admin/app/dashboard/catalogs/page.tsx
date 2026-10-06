import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import CatalogVersionsView from '@/components/lookups/CatalogVersionsView';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import type { CatalogDriftRow } from '@/src/lib/api/client';

export const dynamic = 'force-dynamic';

// Read-only report over entity.catalog_versions / tenant_catalog_versions —
// see catalog-drift.repository.ts (admin-service) for why there is
// deliberately no re-seed action here yet.
export default async function CatalogsPage() {
  const result = await getServerSession();
  if (!result) return null;

  const res = await fetch(`${GATEWAY_URL}/catalogs/drift`, {
    headers: { cookie: result.cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) return <LookupLoadError title="Catalog Versions" status={res.status} />;

  const body = await res.json() as { data: CatalogDriftRow[] };
  return <CatalogVersionsView rows={body.data} />;
}
