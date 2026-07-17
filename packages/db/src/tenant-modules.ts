import { sql } from 'drizzle-orm';
import { withRoleTx, type RoleTxContext } from './transaction.js';

// Reusable across services (hr-service, tasks-service) that need to check a
// tenant's module entitlement (entity.tenant_modules). Reads as the caller's
// own role via withRoleTx so RLS actually scopes the result.
export async function getActiveTenantModules(ctx: RoleTxContext): Promise<string[]> {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT module
      FROM entity.tenant_modules
      WHERE is_active
        AND tenant_id = (
          SELECT tenant_id FROM entity.organizations WHERE id = ${ctx.org_id}
        )
    `)) as Array<{ module: string }>;
    return rows.map((r) => r.module);
  });
}
