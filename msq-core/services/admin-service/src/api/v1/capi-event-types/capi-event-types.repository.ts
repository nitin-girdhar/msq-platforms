import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { metaCapiEventTypesTable } from '@platform/db/schema';

type CapiEventTypeInsert = typeof metaCapiEventTypesTable.$inferInsert;
type CapiEventTypeUpdate = Partial<CapiEventTypeInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(metaCapiEventTypesTable).orderBy(asc(metaCapiEventTypesTable.sortOrder), asc(metaCapiEventTypesTable.label)));
}

export async function create(fields: CapiEventTypeInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(metaCapiEventTypesTable).values(fields).returning();
    return row;
  });
}

// id is a SMALLINT identity column here, not the UUID every other lookup uses
// — the only one in the console. Parsed at the boundary (service layer) so
// the repository stays typed against the real column.
export async function update(id: number, fields: CapiEventTypeUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(metaCapiEventTypesTable).set(fields).where(eq(metaCapiEventTypesTable.id, id)).returning();
    return row ?? null;
  });
}
