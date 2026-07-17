import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { leadStageOutcomeTable, leadStageTable } from '@crm/db/schema';

type LeadStageOutcomeInsert = typeof leadStageOutcomeTable.$inferInsert;
type LeadStageOutcomeUpdate = Partial<LeadStageOutcomeInsert>;

export async function list() {
  return withServiceTx((tx) =>
    tx
      .select({
        id: leadStageOutcomeTable.id,
        stageId: leadStageOutcomeTable.stageId,
        name: leadStageOutcomeTable.name,
        label: leadStageOutcomeTable.label,
        description: leadStageOutcomeTable.description,
        requiresComment: leadStageOutcomeTable.requiresComment,
        sortOrder: leadStageOutcomeTable.sortOrder,
        isActive: leadStageOutcomeTable.isActive,
        stageName: leadStageTable.name,
        stageLabel: leadStageTable.label,
      })
      .from(leadStageOutcomeTable)
      .leftJoin(leadStageTable, eq(leadStageOutcomeTable.stageId, leadStageTable.id))
      .orderBy(asc(leadStageOutcomeTable.label)),
  );
}

export async function create(fields: LeadStageOutcomeInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(leadStageOutcomeTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: LeadStageOutcomeUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(leadStageOutcomeTable).set(fields).where(eq(leadStageOutcomeTable.id, id)).returning();
    return row ?? null;
  });
}
