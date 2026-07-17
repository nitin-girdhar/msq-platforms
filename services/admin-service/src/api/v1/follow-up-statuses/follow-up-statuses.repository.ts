import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { followUpStatusesTable } from '@crm/db/schema';

type FollowUpStatusInsert = typeof followUpStatusesTable.$inferInsert;
type FollowUpStatusUpdate = Partial<FollowUpStatusInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(followUpStatusesTable).orderBy(asc(followUpStatusesTable.label)));
}

export async function create(fields: FollowUpStatusInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(followUpStatusesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: FollowUpStatusUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(followUpStatusesTable).set(fields).where(eq(followUpStatusesTable.id, id)).returning();
    return row ?? null;
  });
}
