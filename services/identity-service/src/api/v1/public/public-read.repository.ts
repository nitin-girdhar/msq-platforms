import { sql } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';

// Public read endpoints run under the service role but with a MANDATORY explicit
// tenant filter and a whitelisted column list — never the tenant_admin role, and
// never SELECT *. The tenant/branch come from the verified API key, not the body.

export async function listBranches(tenantId: string, orgId?: string) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT id, name, brand_name, city, timezone, is_active
      FROM entity.organizations
      WHERE tenant_id = ${tenantId}::uuid
        AND NOT is_deleted
        ${orgId ? sql`AND id = ${orgId}::uuid` : sql``}
      ORDER BY name
    `)) as Array<Record<string, unknown>>;
  });
}

export async function listUsers(tenantId: string, orgId?: string) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT u.id, u.full_name, u.email, u.org_id,
             ur.label AS role_label, u.is_active
      FROM iam.users u
      JOIN entity.organizations o ON o.id = u.org_id
      LEFT JOIN iam.user_roles ur ON ur.id = u.role_id
      WHERE o.tenant_id = ${tenantId}::uuid
        AND NOT o.is_deleted
        AND NOT u.is_deleted
        ${orgId ? sql`AND u.org_id = ${orgId}::uuid` : sql``}
      ORDER BY u.full_name
    `)) as Array<Record<string, unknown>>;
  });
}

export async function orgBelongsToTenant(orgId: string, tenantId: string): Promise<boolean> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1 FROM entity.organizations
      WHERE id = ${orgId}::uuid AND tenant_id = ${tenantId}::uuid AND NOT is_deleted
      LIMIT 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  });
}
