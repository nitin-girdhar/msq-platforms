import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, type RoleTxContext } from './transaction.js';

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

// Gateway entitlement choke point: read a single tenant's active module rows by
// tenant id. Uses withServiceTx (BYPASSRLS) deliberately — this is a system
// operation with no end-user DB session: the gateway runs it after JWT verify,
// so `tenantId` comes from a gateway-verified token (never client input), and it
// reads exactly that one tenant's rows. Callers cache the result (see
// @platform/authz.getTenantProducts) to avoid a query per request.
export async function getActiveTenantModulesByTenantId(tenantId: string): Promise<string[]> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT module
      FROM entity.tenant_modules
      WHERE is_active AND tenant_id = ${tenantId}
    `)) as Array<{ module: string }>;
    return rows.map((r) => r.module);
  });
}
