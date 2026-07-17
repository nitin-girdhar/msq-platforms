import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { taskPrioritiesTable } from '@crm/db/schema';

type TaskPriorityInsert = typeof taskPrioritiesTable.$inferInsert;
type TaskPriorityUpdate = Partial<TaskPriorityInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(taskPrioritiesTable).orderBy(asc(taskPrioritiesTable.sortOrder)));
}

export async function create(fields: TaskPriorityInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(taskPrioritiesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: TaskPriorityUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(taskPrioritiesTable).set(fields).where(eq(taskPrioritiesTable.id, id)).returning();
    return row ?? null;
  });
}
