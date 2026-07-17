import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { campaignStatusesTable } from '@crm/db/schema';

type CampaignStatusInsert = typeof campaignStatusesTable.$inferInsert;
type CampaignStatusUpdate = Partial<CampaignStatusInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(campaignStatusesTable).orderBy(asc(campaignStatusesTable.label)));
}

export async function create(fields: CampaignStatusInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(campaignStatusesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: CampaignStatusUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(campaignStatusesTable).set(fields).where(eq(campaignStatusesTable.id, id)).returning();
    return row ?? null;
  });
}
