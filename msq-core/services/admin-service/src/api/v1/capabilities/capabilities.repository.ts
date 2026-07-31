import { asc, eq, and, or, isNull, isNotNull } from 'drizzle-orm';
import { withServiceTx, withTenantConfigTx } from '@platform/db';
import { capabilitiesTable, roleCapabilitiesTable, userRolesTable } from '@platform/db/schema';

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

// The rank of the role a grant is being written TO, for putGrants' platform-admin
// invariant. Returns undefined for an unknown or deleted id, which the caller
// treats as a rejection rather than a skip.
export async function getRoleRank(roleId: string): Promise<number | undefined> {
  const rows = await withServiceTx((tx) =>
    tx
      .select({ rank: userRolesTable.rank })
      .from(userRolesTable)
      .where(eq(userRolesTable.id, roleId))
      .limit(1),
  );
  return rows[0]?.rank;
}

interface GrantInput {
  capabilityId: string;
  isGranted: boolean;
}

// Upserts tenant OVERRIDE rows only (tenant_id always set) — writes never
// touch the tenant_id IS NULL platform-default rows, matching the RLS
// WITH CHECK, which pins every write to the admin-selected tenant.
//
// withTenantConfigTx is the standard N-6 admin-config path: app_user with
// app.current_tenant_id pinned to the target tenant, which is exactly what
// iam.role_capabilities' admin_tenant_config_policy now keys on. The previous
// version hand-rolled a transaction that first looked up an org in the target
// tenant, because the policy used to derive the tenant from app.current_org_id.
// That read ran before its own SET LOCAL ROLE app_user, so it hit the pool's
// login role (lead_svc), which holds no table grant on entity.organizations —
// every save 500'd with "permission denied for table organizations". Ordering
// was only the first fault: entity.organizations is also FORCE RLS'd to the
// actor's own mapped orgs, so a super_admin editing a tenant they are not a
// member of would have found no org, and the policy's identical subquery would
// have failed the WITH CHECK anyway. Keying on the selected tenant drops the
// entity.organizations dependency on both sides.
export async function upsertGrants(params: {
  actorUserId: string;
  tenantId: string;
  roleId: string;
  grants: GrantInput[];
}) {
  return withTenantConfigTx({ actorUserId: params.actorUserId, tenantId: params.tenantId }, async (tx) => {
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
