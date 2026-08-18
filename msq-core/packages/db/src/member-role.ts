import { sql } from 'drizzle-orm';
import { appDrizzle, type DrizzleTx } from './drizzle.js';

// Runs a resolver query with the same role selection as withRoleTx's app path:
// SET LOCAL ROLE app_user unless this is a product-scoped login (lms_svc/hr_svc/
// task_svc, DB_PRODUCT_SCOPED_LOGIN=true) which is NOINHERIT and holds its own
// direct EXECUTE/USAGE grants. The resolver functions are SECURITY DEFINER, so
// they need no session GUCs — only EXECUTE + schema USAGE, which app_user (or
// the product-scoped login) has. Without this, a NOINHERIT service login
// (lead_svc/*_svc) cannot reach app_user's grants on a bare connection.
async function runResolver<T>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return appDrizzle().transaction(async (tx) => {
    if (process.env['DB_PRODUCT_SCOPED_LOGIN'] !== 'true') {
      await tx.execute(sql.raw('SET LOCAL ROLE app_user'));
    }
    return fn(tx);
  });
}

// P1.3 — GLOBAL-ladder rank resolution, for identity-service's user-management
// authz (rank ceilings on the iam.user_roles ladder, which P1.1/P1.2 keep
// authoritative). Backed by iam.fn_user_org_rank (SECURITY DEFINER, script 01).
// Returns -1 when the user has no active mapping in that org.
export async function resolveGlobalRank(userId: string, orgId: string): Promise<number> {
  const rows = (await runResolver((tx) =>
    tx.execute(sql`SELECT iam.fn_user_org_rank(${userId}::uuid, ${orgId}::uuid) AS rank`),
  )) as unknown as Array<{ rank: number }>;
  return rows[0] ? Number(rows[0].rank) : -1;
}

export interface ResolvedGlobalRole {
  /** iam.user_roles.name, or null when the user has no active role in this org. */
  role: string | null;
  /** The unified iam rank; -1 = no active role in this org. */
  rank: number;
  /** iam.departments.name for the role's department; null for the global anchor
   *  roles (read_only / org_admin / tenant_admin / super_admin), which are
   *  department-less. Product gates combine rank AND department. */
  department: string | null;
}

// Tier C — the ONE role resolver. Every product service calls this so page
// guards and services read the same ladder (the per-product member_roles
// scales this replaced used to disagree). Backed by iam.fn_user_org_role
// (SECURITY DEFINER, 02_schema.sql), so it bypasses RLS on iam.user_roles /
// iam.departments and needs no session GUCs.
export async function resolveGlobalRole(userId: string, orgId: string): Promise<ResolvedGlobalRole> {
  const rows = (await runResolver((tx) =>
    tx.execute(sql`SELECT role, rank, department FROM iam.fn_user_org_role(${userId}::uuid, ${orgId}::uuid)`),
  )) as unknown as Array<{ role: string | null; rank: number; department: string | null }>;
  const row = rows[0];
  if (!row) return { role: null, rank: -1, department: null };
  return { role: row.role, rank: Number(row.rank), department: row.department };
}
