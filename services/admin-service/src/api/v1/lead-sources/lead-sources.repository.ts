import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { leadSourcesTable } from '@crm/db/schema';

type LeadSourceInsert = typeof leadSourcesTable.$inferInsert;
type LeadSourceUpdate = Partial<LeadSourceInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(leadSourcesTable).orderBy(asc(leadSourcesTable.label)));
}

export async function create(fields: LeadSourceInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(leadSourcesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: LeadSourceUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(leadSourcesTable).set(fields).where(eq(leadSourcesTable.id, id)).returning();
    return row ?? null;
  });
}
