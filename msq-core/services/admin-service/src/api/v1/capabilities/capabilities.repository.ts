import { asc, eq, and, or, isNull, isNotNull, sql } from 'drizzle-orm';
import { appDrizzle, withServiceTx, type DrizzleTx } from '@platform/db';
import { capabilitiesTable, roleCapabilitiesTable, organizationsTable } from '@platform/db/schema';

export async function listCapabilities() {
  return withServiceTx((tx) =>
    tx
      .select()
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.isActive, true))
      .orderBy(asc(capabilitiesTable.sortOrder), asc(capabilitiesTable.key)),
  );
}

// Platform defaults (tenant_id IS NULL) plus this tenant's own overrides, for
// one role — matches iam.fn_role_capability_matrix's two visible layers.
export async function listRoleCapabilities(roleId: string, tenantId: string) {
  return withServiceTx((tx) =>
    tx
      .select()
      .from(roleCapabilitiesTable)
      .where(
        and(
          eq(roleCapabilitiesTable.roleId, roleId),
          or(isNull(roleCapabilitiesTable.tenantId), eq(roleCapabilitiesTable.tenantId, tenantId)),
        ),
      ),
  );
}

interface GrantInput {
  capabilityId: string;
  isGranted: boolean;
}

// iam.role_capabilities' admin_tenant_config_policy (db_scripts/06_rls.sql)
// derives the writable tenant from the ACTOR'S CURRENT ORG
// (app.current_org_id -> entity.organizations.tenant_id), not
// app.current_tenant_id directly — unlike the newer per-product lookup
// policies that @platform/db's withTenantConfigTx targets. A super_admin
// managing an arbitrary tenant has no "current org" in that tenant, so this
// resolves one before writing. See role-capabilities.table.ts for the same
// note next to the schema.
async function withTenantOrgTx<T>(
  params: { actorUserId: string; tenantId: string },
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return appDrizzle().transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.tenantId, params.tenantId))
      .limit(1);
    if (!org) {
      throw new Error('This tenant has no organizations yet — create one before assigning capability overrides.');
    }

    if (process.env['DB_PRODUCT_SCOPED_LOGIN'] !== 'true') {
      await tx.execute(sql.raw('SET LOCAL ROLE app_user'));
    }
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${org.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${params.tenantId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${params.actorUserId}, true)`);
    return fn(tx);
  });
}

// Upserts tenant OVERRIDE rows only (tenant_id always set) — writes never
// touch the tenant_id IS NULL platform-default rows, matching the RLS
// WITH CHECK, which pins every write to the actor's own tenant.
export async function upsertGrants(params: {
  actorUserId: string;
  tenantId: string;
  roleId: string;
  grants: GrantInput[];
}) {
  return withTenantOrgTx({ actorUserId: params.actorUserId, tenantId: params.tenantId }, async (tx) => {
    const rows = [];
    for (const grant of params.grants) {
      const [row] = await tx
        .insert(roleCapabilitiesTable)
        .values({
          tenantId: params.tenantId,
          roleId: params.roleId,
          capabilityId: grant.capabilityId,
          isGranted: grant.isGranted,
          createdBy: params.actorUserId,
        })
        .onConflictDoUpdate({
          target: [roleCapabilitiesTable.tenantId, roleCapabilitiesTable.roleId, roleCapabilitiesTable.capabilityId],
          targetWhere: isNotNull(roleCapabilitiesTable.tenantId),
          set: { isGranted: grant.isGranted },
        })
        .returning();
      rows.push(row);
    }
    return rows;
  });
}
