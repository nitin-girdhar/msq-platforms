import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { tenantsTable, tenantDomainsTable, tenantPlanTypesTable, organizationsTable, orgTypesTable } from '@platform/db/schema';

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
      // The grid projects isDeleted but had never filtered on it — a
      // soft-deleted tenant listed as live, indistinguishable from a merely
      // deactivated one.
      .where(eq(tenantsTable.isDeleted, false))
      .orderBy(asc(tenantsTable.name)),
  );
}

export async function create(fields: TenantInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(tenantsTable).values(fields).returning();
    return row;
  });
}

// A session must sit in a real branch (RLS and writes need an org_id), so a
// tenant with no branch can never be switched into from the navbar. Every new
// tenant therefore gets a default branch, created in the SAME transaction as the
// tenant so there is no window where it exists without one. Falls back to any
// org type if 'head_office' was not seeded.
export async function createWithDefaultBranch(fields: TenantInsert) {
  return withServiceTx(async (tx) => {
    const [tenant] = await tx.insert(tenantsTable).values(fields).returning();
    if (!tenant) throw new Error('Tenant insert returned no row');
    const types = await tx.select({ id: orgTypesTable.id, name: orgTypesTable.name }).from(orgTypesTable);
    const orgType = types.find((t) => t.name === 'head_office') ?? types[0];
    await tx.insert(organizationsTable).values({
      tenantId: tenant.id,
      name: `${tenant.name} - Head Office`,
      ...(orgType ? { orgTypeId: orgType.id } : {}),
    });
    return tenant;
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
