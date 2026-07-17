import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { leadStageTable } from '@crm/db/schema';

type LeadStageInsert = typeof leadStageTable.$inferInsert;
type LeadStageUpdate = Partial<LeadStageInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(leadStageTable).orderBy(asc(leadStageTable.label)));
}

// Used by lead-stage-outcome to validate a stage_id FK before insert/update.
export async function getById(id: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.select().from(leadStageTable).where(eq(leadStageTable.id, id));
    return row ?? null;
  });
}

export async function create(fields: LeadStageInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(leadStageTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: LeadStageUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(leadStageTable).set(fields).where(eq(leadStageTable.id, id)).returning();
    return row ?? null;
  });
}
