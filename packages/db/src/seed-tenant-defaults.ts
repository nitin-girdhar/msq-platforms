import { sql } from 'drizzle-orm';
import { withServiceTx } from './transaction.js';

export interface SeededCatalog {
  catalog_key: string;
  seeded_version: number;
  rows_inserted: number;
}

export interface TenantCatalogVersion {
  catalog_key: string;
  version: number;
  seeded_at: string;
  reset_at: string | null;
}

// Tenant provisioning entry point (Platform_Implementation_Plan.md 3B).
// Copies the current version of every default catalog whose gating modules the
// tenant has licensed (entity.tenant_modules) into the tenant's PRIVATE lookup
// tables, and records the seeded version in entity.tenant_catalog_versions.
//
// withServiceTx (BYPASSRLS root_service) is deliberate: this is a system
// operation with no end-user DB session — it runs at tenant creation, before
// any user of the new tenant exists, and it writes tenant-scoped rows across
// multiple product schemas. `tenantId` is server-derived at provisioning
// (never client input). The underlying SQL function is idempotent (catalogs
// already recorded are skipped), so re-running provisioning is safe and never
// overwrites a tenant's later customisations.
//
// Call AFTER the tenant's entity.tenant_modules rows are inserted — only
// licensed products are seeded.
export async function seedTenantDefaults(tenantId: string): Promise<SeededCatalog[]> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT catalog_key, seeded_version, rows_inserted
      FROM entity.seed_tenant_defaults(${tenantId})
    `)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      catalog_key: String(r['catalog_key']),
      seeded_version: Number(r['seeded_version']),
      rows_inserted: Number(r['rows_inserted']),
    }));
  });
}

// Explicit opt-in "reset to defaults" for a single catalog of a single tenant
// (defaults to the catalog's current version). Restores default label/flags/
// sort_order and re-adds any deleted defaults WITHOUT changing row ids (so FKs
// from tenant data stay valid); tenant-custom rows are left untouched.
//
// withServiceTx is used for the same reason as seedTenantDefaults — the seeder
// functions span tenant boundaries and are REVOKEd from every subject role.
// The caller (e.g. lookup-admin acting within a tenant) must supply a
// server-verified `tenantId`, never one taken from client input. Returns the
// number of catalog rows inserted/updated.
export async function resetTenantCatalog(
  tenantId: string,
  catalogKey: string,
  version?: number,
): Promise<number> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT entity.reset_tenant_catalog(${tenantId}, ${catalogKey}, ${version ?? null}) AS affected
    `)) as Array<{ affected: number }>;
    return rows[0] ? Number(rows[0].affected) : 0;
  });
}

// Read a tenant's per-catalog provisioning record (seeded/reset versions).
// System read (withServiceTx) for admin surfaces (lookup-admin) that operate on
// an explicit, server-verified tenant. End-user/tenant-admin reads that must be
// RLS-scoped should query entity.tenant_catalog_versions via withRoleTx instead.
export async function getTenantCatalogVersions(tenantId: string): Promise<TenantCatalogVersion[]> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT catalog_key, version, seeded_at, reset_at
      FROM entity.tenant_catalog_versions
      WHERE tenant_id = ${tenantId}
      ORDER BY catalog_key
    `)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      catalog_key: String(r['catalog_key']),
      version: Number(r['version']),
      seeded_at: String(r['seeded_at']),
      reset_at: r['reset_at'] === null ? null : String(r['reset_at']),
    }));
  });
}
