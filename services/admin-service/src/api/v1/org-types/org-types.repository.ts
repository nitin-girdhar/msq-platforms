import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { orgTypesTable } from '@crm/db/schema';

type OrgTypeInsert = typeof orgTypesTable.$inferInsert;
type OrgTypeUpdate = Partial<OrgTypeInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(orgTypesTable).orderBy(asc(orgTypesTable.label)));
}

export async function create(fields: OrgTypeInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(orgTypesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: OrgTypeUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(orgTypesTable).set(fields).where(eq(orgTypesTable.id, id)).returning();
    return row ?? null;
  });
}

export async function getById(id: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.select().from(orgTypesTable).where(eq(orgTypesTable.id, id)).limit(1);
    return row ?? null;
  });
}
