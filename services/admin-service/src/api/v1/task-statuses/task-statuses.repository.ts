import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { taskStatusesTable } from '@crm/db/schema';

type TaskStatusInsert = typeof taskStatusesTable.$inferInsert;
type TaskStatusUpdate = Partial<TaskStatusInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(taskStatusesTable).orderBy(asc(taskStatusesTable.sortOrder)));
}

export async function create(fields: TaskStatusInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(taskStatusesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: TaskStatusUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(taskStatusesTable).set(fields).where(eq(taskStatusesTable.id, id)).returning();
    return row ?? null;
  });
}
