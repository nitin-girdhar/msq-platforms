import { sql } from 'drizzle-orm';
import { appDrizzle, type DrizzleTx } from './drizzle.js';

// Local copy of the product union (kept in sync with @platform/types' ProductKey).
// Inlined so @platform/db takes no new package dependency for a three-value literal.
type ProductKey = 'lms' | 'hr' | 'task';

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

export interface ResolvedMemberRole {
  /** The product role name (e.g. 'sales_representative', 'hr_admin'), or null
   *  when the user has no active grant in this product+org. */
  role: string | null;
  /** The product rank, or -1 when the user has no active grant (encodes
   *  "not a member of this product in this org"). */
  rank: number;
}

// P1.3 — per-service PRODUCT role resolution. Each product service calls this to
// learn the acting user's role/rank in ITS product, from <product>.member_roles,
// instead of trusting a rank header. Backed by <product>.fn_member_role
// (db_scripts/20), which is SECURITY DEFINER — so it bypasses member_roles RLS
// and needs no session GUCs; it runs on the caller's own login role, which holds
// a direct EXECUTE grant. Fixed per-product SQL (never string-built) keeps the
// schema name off the injection surface.
export async function resolveMemberRole(
  product: ProductKey,
  userId: string,
  orgId: string,
): Promise<ResolvedMemberRole> {
  const query =
    product === 'lms'
      ? sql`SELECT role, rank FROM lms.fn_member_role(${userId}::uuid, ${orgId}::uuid)`
      : product === 'hr'
        ? sql`SELECT role, rank FROM hr.fn_member_role(${userId}::uuid, ${orgId}::uuid)`
        : sql`SELECT role, rank FROM task.fn_member_role(${userId}::uuid, ${orgId}::uuid)`;

  const rows = (await runResolver((tx) => tx.execute(query))) as unknown as Array<{ role: string | null; rank: number }>;
  const row = rows[0];
  if (!row) return { role: null, rank: -1 };
  return { role: row.role, rank: Number(row.rank) };
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

// Tier C — the ONE role resolver. Every product service calls this instead of
// resolveMemberRole so page guards and services read the same ladder (the
// per-product member_roles scales are what used to disagree). Backed by
// iam.fn_user_org_role (SECURITY DEFINER, 02_schema.sql), so it bypasses RLS on
// iam.user_roles / iam.departments and needs no session GUCs.
export async function resolveGlobalRole(userId: string, orgId: string): Promise<ResolvedGlobalRole> {
  const rows = (await runResolver((tx) =>
    tx.execute(sql`SELECT role, rank, department FROM iam.fn_user_org_role(${userId}::uuid, ${orgId}::uuid)`),
  )) as unknown as Array<{ role: string | null; rank: number; department: string | null }>;
  const row = rows[0];
  if (!row) return { role: null, rank: -1, department: null };
  return { role: row.role, rank: Number(row.rank), department: row.department };
}
