import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { tenantsTable, tenantDomainsTable, tenantPlanTypesTable } from '@crm/db/schema';

type TenantInsert = typeof tenantsTable.$inferInsert;
type TenantUpdate = Partial<TenantInsert>;

// Resolved projection: raw FK ids are kept for edit-form pre-fill, and the
// referenced lookup tables' human-readable `label` is joined in alongside so
// the frontend never has to resolve an id itself.
export async function list() {
  return withServiceTx((tx) =>
    tx
      .select({
        id: tenantsTable.id,
        name: tenantsTable.name,
        domainId: tenantsTable.domainId,
        planTypeId: tenantsTable.planTypeId,
        isActive: tenantsTable.isActive,
        isDeleted: tenantsTable.isDeleted,
        metadata: tenantsTable.metadata,
        createdAt: tenantsTable.createdAt,
        updatedAt: tenantsTable.updatedAt,
        domainName: tenantDomainsTable.label,
        planTypeName: tenantPlanTypesTable.label,
      })
      .from(tenantsTable)
      .leftJoin(tenantDomainsTable, eq(tenantsTable.domainId, tenantDomainsTable.id))
      .leftJoin(tenantPlanTypesTable, eq(tenantsTable.planTypeId, tenantPlanTypesTable.id))
      .orderBy(asc(tenantsTable.name)),
  );
}

export async function create(fields: TenantInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(tenantsTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: TenantUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(tenantsTable).set(fields).where(eq(tenantsTable.id, id)).returning();
    return row ?? null;
  });
}

export async function getById(id: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
    return row ?? null;
  });
}
