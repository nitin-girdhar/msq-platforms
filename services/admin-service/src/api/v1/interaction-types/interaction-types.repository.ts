import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { interactionTypesTable } from '@crm/db/schema';

type InteractionTypeInsert = typeof interactionTypesTable.$inferInsert;
type InteractionTypeUpdate = Partial<InteractionTypeInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(interactionTypesTable).orderBy(asc(interactionTypesTable.label)));
}

export async function create(fields: InteractionTypeInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(interactionTypesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: InteractionTypeUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(interactionTypesTable).set(fields).where(eq(interactionTypesTable.id, id)).returning();
    return row ?? null;
  });
}
