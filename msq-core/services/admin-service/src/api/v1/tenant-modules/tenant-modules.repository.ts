import { and, eq } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { tenantModulesTable } from '@platform/db/schema';

export async function list(tenantId: string) {
  return withServiceTx((tx) =>
    tx.select().from(tenantModulesTable).where(eq(tenantModulesTable.tenantId, tenantId)),
  );
}

// One tenant, four modules, toggled together — a small enough set that
// upsert-per-module in a single transaction is simpler than a bulk statement,
// and each module's row is independent (no shared unique index to conflict on
// besides its own (tenant_id, module)).
export async function setActive(tenantId: string, module: string, isActive: boolean) {
  return withServiceTx(async (tx) => {
    const [existing] = await tx
      .select({ id: tenantModulesTable.id })
      .from(tenantModulesTable)
      .where(and(eq(tenantModulesTable.tenantId, tenantId), eq(tenantModulesTable.module, module)));

    if (existing) {
      await tx
        .update(tenantModulesTable)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(tenantModulesTable.id, existing.id));
    } else {
      await tx.insert(tenantModulesTable).values({ tenantId, module, isActive });
    }
  });
}
