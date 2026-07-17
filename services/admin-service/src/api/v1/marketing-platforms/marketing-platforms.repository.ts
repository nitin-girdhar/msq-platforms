import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { marketingPlatformsTable } from '@crm/db/schema';

type MarketingPlatformInsert = typeof marketingPlatformsTable.$inferInsert;
type MarketingPlatformUpdate = Partial<MarketingPlatformInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(marketingPlatformsTable).orderBy(asc(marketingPlatformsTable.label)));
}

export async function create(fields: MarketingPlatformInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(marketingPlatformsTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: MarketingPlatformUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(marketingPlatformsTable).set(fields).where(eq(marketingPlatformsTable.id, id)).returning();
    return row ?? null;
  });
}
