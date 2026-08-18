import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
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
  const rows = body.data;

  const catalogKeys = Array.from(new Set(rows.map((r) => r.catalog_key))).sort();
  const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id)));
  const tenants = tenantIds.map((id) => ({
    id,
    name: rows.find((r) => r.tenant_id === id)?.tenant_name ?? id,
  })).sort((a, b) => a.name.localeCompare(b.name));

  const cell = (tenantId: string, catalogKey: string) =>
    rows.find((r) => r.tenant_id === tenantId && r.catalog_key === catalogKey);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Catalog Versions</h1>
        <p className="mt-1 text-xs text-[#64748B]">
          Each cell is a tenant&apos;s seeded version over the current default. A red cell is behind current or was
          never seeded — not necessarily a problem (a tenant may have customised past what a re-seed would restore),
          but worth checking before assuming every tenant has the latest defaults.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-left text-xs font-semibold text-[#64748B]">
            <tr>
              <th className="sticky left-0 bg-[#F8FAFC] px-4 py-2.5">Tenant</th>
              {catalogKeys.map((key) => (
                <th key={key} className="whitespace-nowrap px-4 py-2.5">{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-[#E2E8F0] last:border-0">
                <td className="sticky left-0 bg-white px-4 py-2.5 font-medium text-[#0F172A]">{t.name}</td>
                {catalogKeys.map((key) => {
                  const c = cell(t.id, key);
                  const drifted = !c || c.tenant_version === null || c.tenant_version < c.current_version;
                  return (
                    <td
                      key={key}
                      className={`whitespace-nowrap px-4 py-2.5 ${drifted ? 'text-red-600' : 'text-[#0F172A]'}`}
                    >
                      {c ? `v${c.tenant_version ?? '—'} / v${c.current_version}` : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={catalogKeys.length + 1} className="px-4 py-6 text-center text-xs text-[#94A3B8]">
                  No tenants.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
