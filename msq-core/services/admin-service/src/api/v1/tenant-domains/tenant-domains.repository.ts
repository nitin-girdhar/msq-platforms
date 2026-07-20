import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { tenantDomainsTable } from '@platform/db/schema';

type TenantDomainInsert = typeof tenantDomainsTable.$inferInsert;
type TenantDomainUpdate = Partial<TenantDomainInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(tenantDomainsTable).orderBy(asc(tenantDomainsTable.label)));
}

export async function create(fields: TenantDomainInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(tenantDomainsTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: TenantDomainUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(tenantDomainsTable).set(fields).where(eq(tenantDomainsTable.id, id)).returning();
    return row ?? null;
  });
}

export async function getById(id: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.select().from(tenantDomainsTable).where(eq(tenantDomainsTable.id, id)).limit(1);
    return row ?? null;
  });
}
