import { sql } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';

export interface CatalogDriftRow {
  tenant_id: string;
  tenant_name: string;
  catalog_key: string;
  current_version: number;
  tenant_version: number | null;
  seeded_at: string | null;
}

// One row per (tenant, registered catalog) — a plain report, no write action.
// Read-only deliberately: entity.seed_tenant_defaults()'s exact behavior on an
// already-provisioned tenant (additive vs. resetting existing customisations)
// needs verifying against db_scripts/10_tenant_provisioning.sql and a real
// database before any "re-seed" button is safe to wire up, so this repository
// only ever reads entity.catalog_versions / entity.tenant_catalog_versions.
export async function list(): Promise<CatalogDriftRow[]> {
  return withServiceTx(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT
        t.id AS tenant_id,
        t.name AS tenant_name,
        cv.catalog_key,
        cv.current_version,
        tcv.version AS tenant_version,
        tcv.seeded_at
      FROM entity.tenants t
      CROSS JOIN entity.catalog_versions cv
      LEFT JOIN entity.tenant_catalog_versions tcv
        ON tcv.tenant_id = t.id AND tcv.catalog_key = cv.catalog_key
      WHERE NOT t.is_deleted
      ORDER BY t.name, cv.catalog_key
    `);
    return rows as unknown as CatalogDriftRow[];
  });
}
