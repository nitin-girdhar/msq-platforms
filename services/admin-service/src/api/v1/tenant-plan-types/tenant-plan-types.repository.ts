import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { tenantPlanTypesTable } from '@platform/db/schema';

type TenantPlanTypeInsert = typeof tenantPlanTypesTable.$inferInsert;
type TenantPlanTypeUpdate = Partial<TenantPlanTypeInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(tenantPlanTypesTable).orderBy(asc(tenantPlanTypesTable.label)));
}

export async function create(fields: TenantPlanTypeInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(tenantPlanTypesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: TenantPlanTypeUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(tenantPlanTypesTable).set(fields).where(eq(tenantPlanTypesTable.id, id)).returning();
    return row ?? null;
  });
}

export async function getById(id: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.select().from(tenantPlanTypesTable).where(eq(tenantPlanTypesTable.id, id)).limit(1);
    return row ?? null;
  });
}
