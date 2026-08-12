import { sql, eq, and, desc } from 'drizzle-orm';
import { withRoleTx, withServiceTx, hasCapability } from '@platform/db';
import type { RoleTxContext, DrizzleTx } from '@platform/db';
import { CAPABILITY, ANCHOR_RANK } from '@platform/rbac';
import {
  usersTable,
  userRolesTable,
  userOrgMappingTable,
  organizationsTable,
  vwUserTeamMembers,
  vwUserOrgChart,
  vwUserOrgAccess,
} from '@platform/db/schema';
// Auto-assignment eligibility bounds on the iam.user_roles ladder (read_only 0 ..
// lms_admin 80). Inlined rather than imported so this repository takes no authz
// dependency; matches packages/db/src/assignment.ts.
const RANK_READ_ONLY = 0;
const RANK_ADMIN = 80;
import type { AddOrgMappingInput } from '@platform/validation';
import { BadRequestError } from '../../../lib/errors.js';
import { reassignOrgLeadsViaLeadsService } from '../../../lib/leads-service-client.js';
import type { CapabilityKey } from '@platform/rbac';

// iam.user_roles is a single ladder shared by every product, and tenant admins
// can create arbitrary custom roles on it (e.g. a "Fitness Trainer" role for
// gym staff) — rank alone never tells you whether a role is actually
// provisioned for a given product. This resolves each row's role against the
// CAPABILITY tree (same fail-closed cache the product's own auth middleware
// gates on) and drops any row whose role doesn't hold `key`. Distinct role
// names are checked once each, not once per row.
async function filterRowsByCapability<T extends Record<string, unknown>>(
  tenantId: string,
  rows: T[],
  key: CapabilityKey,
): Promise<T[]> {
  const roleNames = [...new Set(rows.map((r) => r['role_name'] as string))];
  const eligible = new Set(
    (await Promise.all(roleNames.map(async (name) => [name, await hasCapability(tenantId, name, key)] as const)))
      .filter(([, ok]) => ok)
      .map(([name]) => name),
  );
  return rows.filter((r) => eligible.has(r['role_name'] as string));
}

export async function listUsers(
  ctx: RoleTxContext,
  actorRank: number,
  page: number,
  pageSize: number,
  orgId?: string,
  tenantWide?: boolean,
) {
  const offset = (page - 1) * pageSize;
  const targetOrgId = orgId ?? ctx.org_id;
  // Tenant/super admins with no explicit org_id filter see every user across every
  // branch in their tenant, scoped via entity.organizations.tenant_id rather than a
  // single uom.org_id — same join pattern leads.repository.ts uses for org lookups.
  const scopeClause = tenantWide
    ? sql`o.tenant_id = ${ctx.tenant_id}::uuid`
    : sql`uom.org_id = ${targetOrgId}::uuid`;
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT u.id, u.org_id, u.first_name, u.middle_name, u.last_name, u.full_name,
             u.email, u.mobile, u.is_active, u.force_password_change,
             u.password_changed_at, u.last_login_at, u.manager_id, u.created_at, u.updated_at,
             ur.name  AS role_name,
             ur.label AS role_label,
             ur.rank,
             m.full_name AS manager_name,
             o.name AS org_name,
             COUNT(*) OVER () AS total_count
      FROM iam.user_org_mapping uom
      JOIN iam.users u       ON u.id   = uom.user_id
      JOIN iam.user_roles ur ON ur.id  = uom.role_id
      JOIN entity.organizations o ON o.id = u.org_id
      LEFT JOIN iam.users m  ON m.id   = u.manager_id
      WHERE ${scopeClause} AND uom.is_active AND NOT u.is_deleted AND ur.rank < ${actorRank}
      GROUP BY u.id, uom.role_id, ur.name, ur.label, ur.rank, m.full_name, o.name
      ORDER BY ur.rank DESC, u.full_name
      LIMIT ${pageSize} OFFSET ${offset}
    `)) as Array<Record<string, unknown>>;
    const total = rows[0] ? Number(rows[0]['total_count'] ?? 0) : 0;
    return { users: rows, total, page, page_size: pageSize };
  });
}

export async function getUserById(ctx: RoleTxContext, targetUserId: string) {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT u.id, u.org_id, u.first_name, u.middle_name, u.last_name, u.full_name,
             u.email, u.mobile, u.is_active, u.force_password_change,
             u.password_changed_at, u.last_login_at, u.manager_id, u.created_at, u.updated_at,
             ur.name  AS role_name,
             ur.label AS role_label,
             ur.rank,
             m.full_name AS manager_name
      FROM iam.users u
      JOIN iam.user_org_mapping uom ON uom.user_id = u.id AND uom.org_id = ${ctx.org_id}::uuid AND uom.is_active
      JOIN iam.user_roles ur        ON ur.id = uom.role_id
      LEFT JOIN iam.users m         ON m.id  = u.manager_id
      WHERE u.id = ${targetUserId}::uuid AND NOT u.is_deleted
    `)) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
}

export async function getUserByIdAsService(userId: string) {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT u.id, u.org_id, u.role_id, u.first_name, u.middle_name, u.last_name, u.full_name,
             u.email, u.mobile, u.is_active, u.force_password_change,
             u.password_changed_at, u.last_login_at, u.manager_id, u.created_at, u.updated_at,
             ur.name  AS role_name,
             ur.label AS role_label,
             ur.rank,
             m.full_name AS manager_name
      FROM iam.users u
      JOIN iam.user_roles ur ON ur.id = u.role_id
      LEFT JOIN iam.users m  ON m.id = u.manager_id
      WHERE u.id = ${userId}::uuid AND NOT u.is_deleted
    `)) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
}

// LMS-only (the Assignment Weights admin screen configures lead auto-assignment),
// so the CAPABILITY.LMS filter below is hardcoded rather than parameterized like
// getAssignableUsers' `product` — no other product manages weights through this
// endpoint today.
export async function getAssignmentWeights(ctx: RoleTxContext, orgId?: string) {
  const targetOrgId = orgId ?? ctx.org_id;

  const query = (tx: DrizzleTx) => tx.execute(sql`
      SELECT u.id AS user_id, u.full_name, u.email,
             ur.name AS role_name, ur.label AS role_label, ur.rank,
             uom.lead_assignment_weight AS weight
      FROM iam.user_org_mapping uom
      JOIN iam.users u       ON u.id  = uom.user_id
      JOIN iam.user_roles ur ON ur.id = uom.role_id
      WHERE uom.org_id = ${targetOrgId}::uuid AND uom.is_active AND NOT u.is_deleted AND u.is_active
        AND ur.rank > ${RANK_READ_ONLY} AND ur.rank < ${RANK_ADMIN}
      ORDER BY ur.rank DESC, u.full_name
    `) as Promise<Array<Record<string, unknown>>>;

  // The user form shows each selected branch's current total, which means
  // reading orgs the actor is not currently switched into. withRoleTx is
  // RLS-scoped to ctx.org_id and would return an empty set for any other org,
  // reading as "0%" — a wrong answer rather than an error. The service layer
  // gates cross-org reads on rank and confirms the org is in the actor's tenant
  // before we get here, so the service connection is the correct tool.
  const rows = targetOrgId === ctx.org_id
    ? await withRoleTx(ctx, query)
    : await withServiceTx(query);

  return filterRowsByCapability(ctx.tenant_id, rows, CAPABILITY.LMS);
}

export async function updateAssignmentWeights(
  ctx: RoleTxContext,
  weights: Array<{ user_id: string; weight: number }>,
) {
  return withRoleTx(ctx, async (tx) => {
    const userIds = weights.map((w) => w.user_id);

    // Confirm every targeted user is actually eligible (active mapping, in-range rank)
    // in this org before writing anything — prevents setting a weight on a user who
    // wouldn't be picked by resolveAutoAssignedUser anyway.
    const eligible = (await tx.execute(sql`
      SELECT uom.user_id
      FROM iam.user_org_mapping uom
      JOIN iam.user_roles ur ON ur.id = uom.role_id
      WHERE uom.org_id = ${ctx.org_id}::uuid AND uom.is_active
        AND ur.rank > ${RANK_READ_ONLY} AND ur.rank < ${RANK_ADMIN}
        AND uom.user_id = ANY(${userIds}::uuid[])
    `)) as Array<{ user_id: string }>;
    const eligibleIds = new Set(eligible.map((r) => r.user_id));
    const ineligible = userIds.filter((id) => !eligibleIds.has(id));
    if (ineligible.length > 0) {
      throw new BadRequestError(`Users not eligible for lead assignment in this org: ${ineligible.join(', ')}`);
    }

    const sum = weights.reduce((s, w) => s + w.weight, 0);
    if (sum !== 100 && sum !== 0) {
      throw new BadRequestError(`Assignment weights must sum to 100 (or 0 to disable auto-assignment), got ${sum}`);
    }

    // Single batch UPDATE ... FROM (VALUES ...) instead of one round-trip per user.
    const valueRows = sql.join(
      weights.map((w) => sql`(${w.user_id}::uuid, ${w.weight}::int)`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE iam.user_org_mapping AS m
      SET lead_assignment_weight = v.weight, updated_at = NOW()
      FROM (VALUES ${valueRows}) AS v(user_id, weight)
      WHERE m.user_id = v.user_id AND m.org_id = ${ctx.org_id}::uuid
    `);
  });
}

const PRODUCT_CAPABILITY: Record<'lms' | 'tasks', CapabilityKey> = {
  lms: CAPABILITY.LMS,
  tasks: CAPABILITY.TASKS,
};

export async function getAssignableUsers(
  ctx: RoleTxContext,
  actorRank: number,
  product: 'lms' | 'tasks',
  orgId?: string,
  scope: 'delegation' | 'collaboration' = 'delegation',
  maxRank?: number,
  tenantWide?: boolean,
) {
  const targetOrgId = orgId ?? ctx.org_id;
  // Same join pattern as listUsers: tenant admin+ with no explicit org_id sees
  // candidates across every branch in the tenant, not just their own.
  const scopeClause = tenantWide
    ? sql`o.tenant_id = ${ctx.tenant_id}::uuid`
    : sql`uom.org_id = ${targetOrgId}::uuid`;
  // delegation: strictly below the actor (CRM lead hand-down).
  // collaboration: at or below the actor, so same-rank peers and the actor
  // themselves are assignable (Tasks). See getAssignableQuerySchema.
  // maxRank, when given, overrides both: an absolute ceiling independent of
  // the actor's own rank (e.g. bulk lead assignment).
  const rankFilter =
    maxRank !== undefined
      ? sql`ur.rank <= ${maxRank}`
      : scope === 'collaboration'
        ? sql`ur.rank <= ${actorRank}`
        : sql`ur.rank < ${actorRank}`;
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT u.id, u.org_id, u.full_name, u.first_name, u.middle_name, u.last_name,
             u.email, u.is_active,
             ur.name AS role_name, ur.label AS role_label, ur.rank
      FROM iam.user_org_mapping uom
      JOIN iam.users u       ON u.id  = uom.user_id
      JOIN iam.user_roles ur ON ur.id = uom.role_id
      JOIN entity.organizations o ON o.id = uom.org_id
      WHERE ${scopeClause} AND uom.is_active AND NOT u.is_deleted AND u.is_active
        AND ${rankFilter}
      ORDER BY ur.rank DESC, u.full_name
    `)) as Array<Record<string, unknown>>;
    return filterRowsByCapability(ctx.tenant_id, rows, PRODUCT_CAPABILITY[product]);
  });
}

export async function getTeamMembers(ctx: RoleTxContext) {
  return withRoleTx(ctx, async (tx) => {
    return tx.select({
      managerId:      vwUserTeamMembers.managerId,
      memberId:       vwUserTeamMembers.memberId,
      memberFullName: vwUserTeamMembers.memberFullName,
      memberEmail:    vwUserTeamMembers.memberEmail,
      memberRole:     vwUserTeamMembers.memberRole,
      depth:          vwUserTeamMembers.depth,
      isActive:       vwUserTeamMembers.isActive,
    })
      .from(vwUserTeamMembers)
      .where(
        and(
          eq(vwUserTeamMembers.orgId, ctx.org_id),
          eq(vwUserTeamMembers.managerId, ctx.user_id),
        ),
      );
  });
}

export async function getOrgChart(ctx: RoleTxContext) {
  return withRoleTx(ctx, async (tx) => {
    return tx.select({
      userId:          vwUserOrgChart.userId,
      fullName:        vwUserOrgChart.fullName,
      email:           vwUserOrgChart.email,
      managerId:       vwUserOrgChart.managerId,
      managerFullName: vwUserOrgChart.managerFullName,
      roleName:        vwUserOrgChart.roleName,
      hierarchyLevel:  vwUserOrgChart.hierarchyLevel,
    })
      .from(vwUserOrgChart)
      .where(eq(vwUserOrgChart.orgId, ctx.org_id));
  });
}

// One branch's membership, with its role already resolved to an id and checked
// against the actor's rank ceiling by the service layer. The repository trusts
// these ids — it does not re-authorize them.
export interface ResolvedAssignment {
  org_id: string;
  role_id: string;
  lead_assignment_weight?: number | undefined;
}

export interface CreateUserData {
  first_name: string;
  middle_name?: string;
  last_name?: string;
  email: string;
  // Normalized to E.164 by mobileInputSchema; null clears it.
  mobile?: string | null;
  // Legacy single-branch path. Required unless org_assignments is given.
  role_name?: string;
  manager_id?: string;
  force_password_change?: boolean;
  password_hash: string;
  // Multi-branch path. When present, home_org_id is too, and it is one of these.
  org_assignments?: ResolvedAssignment[];
  home_org_id?: string;
}

// Roles are tenant-owned since _migrations/23_tenant_scope_admin_roles.sql, so
// the same name legitimately exists once per tenant. Resolving by name alone
// with limit(1) would pick an ARBITRARY tenant's row — handing this user a role
// their own tenant does not own, which fn_role_capability_matrix then resolves
// to no capabilities at all. The org pins which tenant's copy is meant.
function roleIdByNameForOrg(
  tx: Parameters<Parameters<typeof withServiceTx>[0]>[0],
  roleName: string,
  orgId: string,
) {
  return tx
    .select({ id: userRolesTable.id })
    .from(userRolesTable)
    .innerJoin(organizationsTable, eq(organizationsTable.tenantId, userRolesTable.tenantId))
    .where(and(eq(userRolesTable.name, roleName), eq(organizationsTable.id, orgId)))
    .limit(1);
}

export async function resolveRoleByName(roleName: string, orgId: string) {
  return withServiceTx(async (tx) => {
    const [row] = await roleIdByNameForOrg(tx, roleName, orgId);
    return row ?? null;
  });
}

// Resolves a tenant from an org rather than trusting a caller-supplied
// tenant_id. super_admin is the one global, tenant-less role (see
// packages/rbac/src/ranks.ts) so its session never carries a real tenant_id —
// but it always carries a real org_id, and every org belongs to exactly one
// tenant. Same pattern as orgs.repository.ts's getAllOrgs.
export async function getTenantIdForOrg(orgId: string): Promise<string | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT tenant_id FROM entity.organizations WHERE id = ${orgId}::uuid
    `)) as Array<{ tenant_id: string }>;
    return rows[0]?.tenant_id ?? null;
  });
}

// All non-deleted departments in a tenant, independent of whether any role
// currently references them. getRoleCatalog used to derive this list from the
// roles it returned, which hid any department with zero visible roles filed
// under it (including every department on a freshly seeded tenant, since
// entity.seed_tenant_rbac() clones roles with department_id = NULL).
export async function getDepartmentsForTenant(tenantId: string) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT id, label FROM iam.departments
      WHERE tenant_id = ${tenantId}::uuid AND NOT is_deleted
      ORDER BY label
    `)) as Array<{ id: string; label: string }>;
  });
}

// The assignable-role catalog for ONE tenant, capped at the actor's own rank.
//
// Applying the ceiling here rather than in the UI is the point: the caller can
// only ever see roles it is allowed to grant, so a hand-rolled request cannot
// name a role the dropdown would have hidden. `super_admin` is excluded by name
// as well as by the tenant filter — it is the one global row and must never be
// grantable from a product screen (same reasoning as user-roles.repository.ts).
//
// department_id is nullable and, on a freshly provisioned tenant, is NULL for
// every role (entity.seed_tenant_rbac clones templates without one). Callers
// must therefore treat "no department" as a real bucket, not an error.
export async function getRoleCatalog(tenantId: string, maxRank: number) {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ur.id, ur.name, ur.label, ur.rank,
             ur.department_id, d.label AS department_label
      FROM iam.user_roles ur
      LEFT JOIN iam.departments d ON d.id = ur.department_id AND NOT d.is_deleted
      WHERE ur.tenant_id = ${tenantId}::uuid
        AND ur.is_active
        AND ur.name <> 'super_admin'
        AND ur.rank < ${maxRank}
      ORDER BY ur.rank DESC, ur.label
    `)) as Array<Record<string, unknown>>;
    return rows;
  });
}

// Who may be set as a user's manager in `orgId`.
//
// Two disjoint groups, unioned:
//   - anyone holding an active mapping in that branch, at any rank; and
//   - tenant_admin/super_admin (rank > 980), who legitimately manage across
//     branches. The bound is strictly > 980 so an org_admin of a DIFFERENT
//     branch is excluded — their authority does not reach this one.
//
// This cannot be done client-side: the roster carries each user's home org_id
// only, so someone mapped into this branch from elsewhere would be invisible.
export async function getManagerCandidates(tenantId: string, orgId: string) {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT DISTINCT u.id, u.full_name, u.email,
             ur.name AS role_name, ur.label AS role_label, ur.rank,
             (uom.user_id IS NOT NULL) AS in_branch
      FROM iam.users u
      JOIN iam.user_roles ur       ON ur.id = u.role_id
      JOIN entity.organizations o  ON o.id  = u.org_id
      LEFT JOIN iam.user_org_mapping uom
             ON uom.user_id = u.id AND uom.org_id = ${orgId}::uuid AND uom.is_active
      WHERE u.is_active AND NOT u.is_deleted
        AND o.tenant_id = ${tenantId}::uuid
        AND (uom.user_id IS NOT NULL OR ur.rank > ${ANCHOR_RANK.ORG_ADMIN})
      ORDER BY in_branch DESC, ur.rank DESC, u.full_name
    `)) as Array<Record<string, unknown>>;
    return rows;
  });
}

// Resolve the roles named by an org_assignments payload, rejecting any that
// belong to another tenant. Batched: an assignment list is validated as a whole,
// so one round-trip is enough and a partial resolve never half-applies.
export async function getRolesByIdsForTenant(roleIds: string[], tenantId: string) {
  if (roleIds.length === 0) return [];
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, name, rank
      FROM iam.user_roles
      WHERE id = ANY(${roleIds}::uuid[])
        AND is_active
        AND (tenant_id = ${tenantId}::uuid OR tenant_id IS NULL)
    `)) as Array<{ id: string; name: string; rank: number }>;
    return rows;
  });
}

// Confirm every org in an assignment list is a live branch of this tenant.
// Returns the ones that resolved, so the caller can name the ones that did not.
export async function getOrgsInTenant(orgIds: string[], tenantId: string) {
  if (orgIds.length === 0) return [];
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, name
      FROM entity.organizations
      WHERE id = ANY(${orgIds}::uuid[])
        AND tenant_id = ${tenantId}::uuid
        AND is_active AND NOT is_deleted
    `)) as Array<{ id: string; name: string }>;
    return rows;
  });
}

// Supersede a user's reporting line in one org, effective today.
//
// iam.users.manager_id is only a display mirror now (a DB trigger keeps it in
// step), so setting a manager means opening a row in iam.reporting_lines and
// closing whatever was open before. Closing rather than overwriting is the whole
// point of the table: "who did this person report to in March" stays answerable
// after a re-org, which is what iam.fn_is_in_subtree(mgr, member, as_of) reads.
//
// Must run in the same transaction as the caller so the close and the open are
// never visible apart — excl_reporting_lines_overlap would reject the new row if
// the old one were still open, and a crash between them would leave the user
// with no manager at all.
//
// Two changes on the same day would produce a zero-width [d, d) range, which
// chk_reporting_lines_range rejects; a line opened today is therefore superseded
// in place (soft-deleted) rather than closed. The day's earlier manager is not
// preserved — same-day churn is correction, not history.
//
// The caller must have already ensured both parties hold an active
// iam.user_org_mapping row in orgId; iam.check_reporting_line_membership()
// enforces it regardless, but a service-layer check gives a better error.
async function setReportingLine(
  tx: DrizzleTx,
  opts: { userId: string; orgId: string; managerId: string | null; actorId?: string | undefined },
): Promise<void> {
  const { userId, orgId, managerId, actorId } = opts;

  await tx.execute(sql`
    UPDATE iam.reporting_lines
       SET is_deleted = TRUE, is_active = FALSE,
           deleted_at = CLOCK_TIMESTAMP(),
           deleted_by = ${actorId ?? null}
     WHERE user_id = ${userId}::uuid AND org_id = ${orgId}::uuid
       AND NOT is_deleted AND effective_to IS NULL
       AND effective_from >= CURRENT_DATE
  `);

  await tx.execute(sql`
    UPDATE iam.reporting_lines
       SET effective_to = CURRENT_DATE
     WHERE user_id = ${userId}::uuid AND org_id = ${orgId}::uuid
       AND NOT is_deleted AND effective_to IS NULL
       AND effective_from < CURRENT_DATE
  `);

  if (!managerId) return;

  // tenant_id is derived rather than passed: the org already knows its tenant,
  // and deriving it here means a caller cannot open a line into the wrong one.
  await tx.execute(sql`
    INSERT INTO iam.reporting_lines (tenant_id, org_id, user_id, manager_id, effective_from)
    SELECT o.tenant_id, ${orgId}::uuid, ${userId}::uuid, ${managerId}::uuid, CURRENT_DATE
    FROM entity.organizations o
    WHERE o.id = ${orgId}::uuid
  `);
}

// True when the user is an active member of the org — the precondition
// iam.check_reporting_line_membership() enforces at the DB level. Checked in the
// service layer too so the API can answer with a clean 400 rather than leaking a
// trigger exception.
export async function isActiveOrgMember(
  ctx: RoleTxContext,
  userId: string,
  orgId: string,
): Promise<boolean> {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1
      FROM iam.user_org_mapping uom
      JOIN iam.users u ON u.id = uom.user_id
      WHERE uom.user_id = ${userId}::uuid
        AND uom.org_id  = ${orgId}::uuid
        AND uom.is_active
        AND u.is_active AND NOT u.is_deleted
      LIMIT 1
    `)) as Array<unknown>;
    return rows.length > 0;
  });
}

export async function createUser(ctx: RoleTxContext, data: CreateUserData) {
  return withRoleTx(ctx, async (tx) => {
    // Two ways in. The legacy path names a role and lands the user in the
    // actor's own org. The multi-branch path carries a resolved assignment per
    // branch plus which of them is home. Both converge on one INSERT below, so
    // the RLS id-minting and the mapping-before-reporting-line ordering are
    // written once and cannot drift apart.
    const assignments: ResolvedAssignment[] = data.org_assignments ?? [];
    let homeOrgId: string;
    let roleId: string;

    if (assignments.length > 0) {
      homeOrgId = data.home_org_id!;
      const home = assignments.find((a) => a.org_id === homeOrgId);
      // Guaranteed by createUserSchema's refine; re-asserted because this is the
      // last point where a mismatch is still cheap to catch.
      if (!home) throw new BadRequestError('home_org_id must be one of the selected branches');
      roleId = home.role_id;
    } else {
      const [roleRow] = await roleIdByNameForOrg(tx, data.role_name!, ctx.org_id);
      if (!roleRow) throw new BadRequestError(`Role not found: ${data.role_name}`);
      homeOrgId = ctx.org_id;
      roleId = roleRow.id;
    }

    // Mint the new user id up-front rather than reading it back with RETURNING.
    // Postgres evaluates a RETURNING clause through the table's SELECT (USING)
    // policy; on the RLS app pool the `users_org_select` policy only admits ids
    // present in iam.fn_org_active_users(app.current_org_id), which derives from
    // iam.user_org_mapping. The mapping row is inserted *after* this statement, so a
    // RETURNING read of the just-inserted row fails the SELECT policy and Postgres
    // raises "new row violates row-level security policy" (42501) → rollback → 500
    // for org_admin and every rank-40–980 app-pool role. Generating the id first
    // removes the read-back entirely, so the INSERT no longer depends on post-insert
    // SELECT visibility. We use the DB's own gen_uuidv7() (matching the column
    // default) so ids keep their time-ordered UUIDv7 form; this SELECT touches no
    // table, so no RLS policy applies. Non-RLS pools (super_admin/tenant_admin) are
    // unaffected — they never tripped the policy and simply use the supplied id.
    const idRows = (await tx.execute(
      sql`SELECT gen_uuidv7() AS id`,
    )) as Array<{ id: string }>;
    const newUserId = idRows[0]!.id;

    await tx.execute(sql`
      INSERT INTO iam.users
        (id, org_id, first_name, middle_name, last_name, email, mobile, role_id,
         manager_id, password_hash, password_changed_at, is_active, force_password_change)
      VALUES (
        ${newUserId}::uuid,
        ${homeOrgId}::uuid,
        ${data.first_name},
        ${data.middle_name ?? null},
        ${data.last_name ?? ''},
        ${data.email},
        ${data.mobile ?? null},
        ${roleId}::uuid,
        -- manager_id is left NULL here on purpose: the reporting line written
        -- below is the real record, and its trigger mirrors the value back.
        NULL,
        ${data.password_hash},
        CLOCK_TIMESTAMP(),
        TRUE,
        ${data.force_password_change ?? true}
      )
    `);
    const created = { id: newUserId };

    // One mapping row per branch — or exactly one, for the legacy path.
    const rows: ResolvedAssignment[] =
      assignments.length > 0
        ? assignments
        : [{ org_id: homeOrgId, role_id: roleId }];

    for (const a of rows) {
      await tx
        .insert(userOrgMappingTable)
        .values({
          userId:               created.id,
          orgId:                a.org_id,
          roleId:               a.role_id,
          leadAssignmentWeight: a.lead_assignment_weight ?? 0,
          grantedBy:            ctx.user_id,
        })
        .onConflictDoUpdate({
          target: [userOrgMappingTable.userId, userOrgMappingTable.orgId],
          set: {
            roleId:               a.role_id,
            isActive:             true,
            leadAssignmentWeight: a.lead_assignment_weight ?? 0,
            updatedAt:            new Date(),
          },
        });
    }

    // After the mapping, never before: iam.check_reporting_line_membership()
    // requires the new user to be an active member of the org.
    if (data.manager_id) {
      await ensureManagerMembership(tx, {
        managerId: data.manager_id,
        orgId:     homeOrgId,
        actorId:   ctx.user_id,
      });
      await setReportingLine(tx, {
        userId:    created.id,
        orgId:     homeOrgId,
        managerId: data.manager_id,
        actorId:   ctx.user_id,
      });
    }

    return created;
  });
}

// A manager qualifying by rank alone (tenant_admin/super_admin) may hold no
// mapping in the branch they are about to manage — and
// iam.check_reporting_line_membership() requires BOTH parties to be active
// members, so the reporting-line insert would fail on a trigger exception the
// admin cannot act on.
//
// Granting the mapping is the honest resolution: being someone's manager in a
// branch IS membership of it. Weight 0 so the grant never silently enters them
// into that branch's lead rotation. Returns true when a row was actually
// created, so the caller can tell the admin it happened.
async function ensureManagerMembership(
  tx: DrizzleTx,
  opts: { managerId: string; orgId: string; actorId?: string | undefined },
): Promise<boolean> {
  const { managerId, orgId, actorId } = opts;

  const existing = (await tx.execute(sql`
    SELECT 1 FROM iam.user_org_mapping
    WHERE user_id = ${managerId}::uuid AND org_id = ${orgId}::uuid AND is_active
    LIMIT 1
  `)) as Array<unknown>;
  if (existing.length > 0) return false;

  // The manager keeps their own default role in the new branch — inventing a
  // different one here would silently change what they can do there.
  const granted = (await tx.execute(sql`
    INSERT INTO iam.user_org_mapping (user_id, org_id, role_id, lead_assignment_weight, granted_by)
    SELECT ${managerId}::uuid, ${orgId}::uuid, u.role_id, 0, ${actorId ?? null}
    FROM iam.users u
    WHERE u.id = ${managerId}::uuid
    ON CONFLICT (user_id, org_id)
      DO UPDATE SET is_active = TRUE, updated_at = CLOCK_TIMESTAMP()
    RETURNING user_id
  `)) as Array<{ user_id: string }>;

  return granted.length > 0;
}

export interface UpdateUserFields {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  email?: string;
  // Normalized to E.164 by mobileInputSchema; null clears it.
  mobile?: string | null;
  is_active?: boolean;
  force_password_change?: boolean;
  manager_id?: string | null;
  role_id?: string;
  password_hash?: string;
  password_changed_at?: Date;
}

export async function updateUser(
  ctx: RoleTxContext,
  targetUserId: string,
  fields: UpdateUserFields,
  // The org whose reporting line a manager change applies to. A user can report
  // to different managers in different orgs, so "set their manager" is only
  // meaningful against a specific one; the service passes the target user's org.
  reportingOrgId?: string,
) {
  return withRoleTx(ctx, async (tx) => {
    const chunks: ReturnType<typeof sql>[] = [];

    if (fields.first_name !== undefined)          chunks.push(sql`first_name = ${fields.first_name}`);
    if (fields.last_name !== undefined)           chunks.push(sql`last_name = ${fields.last_name}`);
    if (fields.middle_name !== undefined)         chunks.push(sql`middle_name = ${fields.middle_name}`);
    if (fields.email !== undefined)               chunks.push(sql`email = ${fields.email}`);
    if (fields.mobile !== undefined)              chunks.push(sql`mobile = ${fields.mobile}`);
    if (fields.is_active !== undefined)           chunks.push(sql`is_active = ${fields.is_active}`);
    if (fields.force_password_change !== undefined) chunks.push(sql`force_password_change = ${fields.force_password_change}`);
    if (fields.role_id !== undefined)             chunks.push(sql`role_id = ${fields.role_id}::uuid`);
    if (fields.password_hash !== undefined)       chunks.push(sql`password_hash = ${fields.password_hash}`);
    if (fields.password_changed_at !== undefined) chunks.push(sql`password_changed_at = ${fields.password_changed_at.toISOString()}::timestamptz`);

    // manager_id is deliberately NOT in the SET list: it is a mirror of
    // iam.reporting_lines, and writing it directly would put the two out of step
    // until the next line change. Supersede the line instead and let the trigger
    // update the column.
    if (fields.manager_id !== undefined && reportingOrgId) {
      await setReportingLine(tx, {
        userId:    targetUserId,
        orgId:     reportingOrgId,
        managerId: fields.manager_id,
        actorId:   ctx.user_id,
      });
    }

    if (chunks.length === 0) {
      // A manager-only change still succeeded — report the user as updated
      // rather than the "nothing to do" null the caller treats as a 404.
      if (fields.manager_id !== undefined && reportingOrgId) return { id: targetUserId };
      return null;
    }

    const setClause = sql.join(chunks, sql`, `);
    // super_admin manages users across every org/tenant, so it runs on the
    // unrestricted service connection (see withRoleTx) and must not be
    // additionally narrowed to its own session org here.
    const orgScope = ctx.role === 'super_admin' ? sql`TRUE` : sql`org_id = ${ctx.org_id}::uuid`;
    const rows = (await tx.execute(sql`
      UPDATE iam.users
      SET ${setClause}
      WHERE id = ${targetUserId}::uuid AND ${orgScope} AND NOT is_deleted
      RETURNING id, password_changed_at, role_id
    `)) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
}

// Reassigns a user's still-open leads to another active user in the SAME org —
// used when deactivating a user, since their login goes away but their open
// leads in that branch still need an owner. Leads are LMS-owned data (N-5) —
// identity invokes leads-service rather than writing lms.marketing_leads itself.
export async function reassignUserLeadsInOrg(
  ctx: RoleTxContext,
  targetUserId: string,
  orgId: string,
  reassignTo: string | null,
): Promise<number> {
  return reassignOrgLeadsViaLeadsService({
    orgId,
    fromUserId: targetUserId,
    toUserId: reassignTo,
    actorId: ctx.user_id,
  });
}

export interface MoveUserBranchResult {
  newOrgName: string;
  reassignedLeadsCount: number;
}

// Cross-org, so the org-move writes run as a service tx rather than a role tx —
// same reasoning as leads.repository.ts's transferLead: the actor's role tx is
// scoped to a single org via RLS, but this write spans two orgs. Reassign-then-
// move saga (N-5): leads-service reassigns and confirms the departing user's
// open leads BEFORE the org move is committed, so a lead is never left assigned
// to a user no longer in that org. Atomicity is necessarily lost across the two
// services — if the org-move write below fails after a successful reassignment,
// the leads stay reassigned; that's the accepted tradeoff of the saga.
export async function moveUserBranch(
  ctx: RoleTxContext,
  targetUserId: string,
  oldOrgId: string,
  newOrgId: string,
  roleId: string,
  reassignLeadsTo?: string,
): Promise<MoveUserBranchResult> {
  const targetOrg = await withServiceTx(async (tx) => {
    const [row] = (await tx.execute(sql`
      SELECT o.id, o.name
      FROM entity.organizations o
      WHERE o.id = ${newOrgId}::uuid
        AND o.tenant_id = ${ctx.tenant_id}::uuid
        AND NOT o.is_deleted AND o.is_active
    `)) as Array<{ id: string; name: string }>;
    return row ?? null;
  });
  if (!targetOrg) throw new BadRequestError('Target branch not found or not in this tenant');

  const reassignedLeadsCount = reassignLeadsTo
    ? await reassignOrgLeadsViaLeadsService({ orgId: oldOrgId, fromUserId: targetUserId, toUserId: reassignLeadsTo, actorId: ctx.user_id })
    : 0;

  await withServiceTx(async (tx) => {
    await tx.execute(sql`
      UPDATE iam.users SET org_id = ${newOrgId}::uuid, updated_at = NOW()
      WHERE id = ${targetUserId}::uuid
    `);

    await tx.execute(sql`
      UPDATE iam.user_org_mapping SET is_active = false, updated_at = NOW()
      WHERE user_id = ${targetUserId}::uuid AND org_id = ${oldOrgId}::uuid
    `);

    await tx
      .insert(userOrgMappingTable)
      .values({ userId: targetUserId, orgId: newOrgId, roleId, grantedBy: ctx.user_id })
      .onConflictDoUpdate({
        target: [userOrgMappingTable.userId, userOrgMappingTable.orgId],
        set: { roleId, isActive: true, updatedAt: new Date() },
      });
  });

  return { newOrgName: targetOrg.name, reassignedLeadsCount };
}

export interface ReconcileResult {
  added: string[];
  updated: string[];
  removed: string[];
  managerGrantedInOrg: string | null;
}

// Bring a user's branch memberships in line with `assignments`, in one
// transaction so the user is never briefly a member of nothing.
//
// Runs on the service connection, not the actor's role tx: reconciling spans
// several orgs at once and an RLS-scoped tx can only see one. The service layer
// has already checked the actor may act in every org named here.
//
// Removals are soft (is_active = false), matching removeOrgMapping — the row
// carries granted_by/granted_at history that a DELETE would destroy, and a
// re-grant later flips the same row back rather than losing the audit trail.
//
// addOrgMapping is deliberately NOT reused: it defaults lead_assignment_weight
// to 0 when the field is absent, which would silently zero a branch's weight on
// any edit that didn't touch it.
export async function reconcileOrgAssignments(
  ctx: RoleTxContext,
  targetUserId: string,
  assignments: ResolvedAssignment[],
  managerId?: string | null,
  homeOrgId?: string,
): Promise<ReconcileResult> {
  return withServiceTx(async (tx) => {
    const current = (await tx.execute(sql`
      SELECT org_id, role_id, lead_assignment_weight, is_active
      FROM iam.user_org_mapping
      WHERE user_id = ${targetUserId}::uuid
    `)) as Array<{ org_id: string; role_id: string; lead_assignment_weight: number; is_active: boolean }>;

    const currentById = new Map(current.map((r) => [r.org_id, r]));
    const wanted = new Set(assignments.map((a) => a.org_id));

    const added: string[] = [];
    const updated: string[] = [];

    for (const a of assignments) {
      const weight = a.lead_assignment_weight ?? 0;
      const existing = currentById.get(a.org_id);

      if (!existing || !existing.is_active) {
        added.push(a.org_id);
      } else if (existing.role_id !== a.role_id || existing.lead_assignment_weight !== weight) {
        updated.push(a.org_id);
      } else {
        continue; // identical — skip the write entirely
      }

      await tx
        .insert(userOrgMappingTable)
        .values({
          userId:               targetUserId,
          orgId:                a.org_id,
          roleId:               a.role_id,
          leadAssignmentWeight: weight,
          grantedBy:            ctx.user_id,
        })
        .onConflictDoUpdate({
          target: [userOrgMappingTable.userId, userOrgMappingTable.orgId],
          set: {
            roleId:               a.role_id,
            isActive:             true,
            leadAssignmentWeight: weight,
            updatedAt:            new Date(),
          },
        });
    }

    const removed = current
      .filter((r) => r.is_active && !wanted.has(r.org_id))
      .map((r) => r.org_id);

    if (removed.length > 0) {
      await tx.execute(sql`
        UPDATE iam.user_org_mapping
        SET is_active = false, updated_at = NOW()
        WHERE user_id = ${targetUserId}::uuid AND org_id = ANY(${removed}::uuid[])
      `);

      // A reporting line in a branch the user no longer belongs to would leave
      // check_reporting_line_membership()'s invariant violated for existing
      // rows, and strand an approver chain pointing into a branch they left.
      await tx.execute(sql`
        UPDATE iam.reporting_lines
        SET effective_to = CURRENT_DATE, is_active = FALSE, updated_at = NOW()
        WHERE user_id = ${targetUserId}::uuid
          AND org_id = ANY(${removed}::uuid[])
          AND NOT is_deleted AND effective_to IS NULL
          AND effective_from < CURRENT_DATE
      `);
      await tx.execute(sql`
        UPDATE iam.reporting_lines
        SET is_deleted = TRUE, is_active = FALSE,
            deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${ctx.user_id}::uuid
        WHERE user_id = ${targetUserId}::uuid
          AND org_id = ANY(${removed}::uuid[])
          AND NOT is_deleted AND effective_to IS NULL
      `);
    }

    // The manager line always follows the home branch, and is rewritten after
    // the mappings so both parties are members by the time the trigger checks.
    let managerGrantedInOrg: string | null = null;
    if (homeOrgId !== undefined && managerId !== undefined) {
      if (managerId) {
        const grantedNow = await ensureManagerMembership(tx, {
          managerId,
          orgId:   homeOrgId,
          actorId: ctx.user_id,
        });
        if (grantedNow) managerGrantedInOrg = homeOrgId;
      }
      await setReportingLine(tx, {
        userId:    targetUserId,
        orgId:     homeOrgId,
        managerId: managerId ?? null,
        actorId:   ctx.user_id,
      });
    }

    return { added, updated, removed, managerGrantedInOrg };
  });
}

// Point iam.users at a new home branch without the cross-service lead
// reassignment moveUserBranch performs. Used when the home radio moves between
// branches the user ALREADY belongs to — nothing is being left, so no lead is
// orphaned and there is nothing to reassign.
export async function setHomeOrg(targetUserId: string, homeOrgId: string, roleId: string) {
  return withServiceTx(async (tx) => {
    await tx.execute(sql`
      UPDATE iam.users
      SET org_id = ${homeOrgId}::uuid, role_id = ${roleId}::uuid, updated_at = NOW()
      WHERE id = ${targetUserId}::uuid
    `);
  });
}

export async function syncOrgMappingRole(ctx: RoleTxContext, userId: string, roleId: string) {
  return withRoleTx(ctx, async (tx) => {
    await tx
      .update(userOrgMappingTable)
      .set({ roleId, updatedAt: new Date() })
      .where(
        and(
          eq(userOrgMappingTable.userId, userId),
          eq(userOrgMappingTable.orgId, ctx.org_id),
        ),
      );
  });
}

export async function softDeleteUser(ctx: RoleTxContext, targetUserId: string) {
  return withRoleTx(ctx, async (tx) => {
    // super_admin manages users across every org/tenant on the unrestricted
    // service connection (see withRoleTx) — must not be narrowed to its own
    // session org here, same reasoning as updateUser above.
    const orgScope = ctx.role === 'super_admin' ? sql`TRUE` : sql`org_id = ${ctx.org_id}::uuid`;
    await tx.execute(sql`
      UPDATE iam.users
      SET is_deleted = TRUE, is_active = FALSE,
          deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${ctx.user_id}::uuid
      WHERE id = ${targetUserId}::uuid AND ${orgScope}
    `);
    await tx
      .update(userOrgMappingTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(userOrgMappingTable.userId, targetUserId));
  });
}

export async function adminResetPassword(
  ctx: RoleTxContext,
  targetUserId: string,
  passwordHash: string,
) {
  return withRoleTx(ctx, async (tx) => {
    const orgScope = ctx.role === 'super_admin' ? sql`TRUE` : sql`org_id = ${ctx.org_id}::uuid`;
    const rows = (await tx.execute(sql`
      UPDATE iam.users
      SET password_hash = ${passwordHash},
          password_changed_at = CLOCK_TIMESTAMP(),
          force_password_change = TRUE
      WHERE id = ${targetUserId}::uuid AND ${orgScope} AND NOT is_deleted
      RETURNING id
    `)) as Array<{ id: string }>;
    return rows[0] ?? null;
  });
}

// Multi-org grant/revoke — a user can hold access (with a role) in more than
// one org at once via iam.user_org_mapping. The view already resolves
// org_name/role_label so callers never have to look up a raw id themselves.
export async function listOrgMappings(userId: string) {
  return withServiceTx((tx) =>
    tx
      .select({
        userId:           vwUserOrgAccess.userId,
        userFullName:     vwUserOrgAccess.userFullName,
        userEmail:        vwUserOrgAccess.userEmail,
        userIsActive:     vwUserOrgAccess.userIsActive,
        orgId:            vwUserOrgAccess.orgId,
        orgName:          vwUserOrgAccess.orgName,
        tenantId:         vwUserOrgAccess.tenantId,
        tenantName:       vwUserOrgAccess.tenantName,
        roleName:         vwUserOrgAccess.roleName,
        roleLabel:        vwUserOrgAccess.roleLabel,
        roleRank:         vwUserOrgAccess.roleRank,
        grantedAt:        vwUserOrgAccess.grantedAt,
        mappingUpdatedAt: vwUserOrgAccess.mappingUpdatedAt,
        // Not on the view, and both needed to seed the Edit user form: without
        // role_id the form cannot preselect each branch's role, and without the
        // weight an edit would round-trip every branch back to 0.
        roleId:               userOrgMappingTable.roleId,
        leadAssignmentWeight: userOrgMappingTable.leadAssignmentWeight,
        isActive:             userOrgMappingTable.isActive,
      })
      .from(vwUserOrgAccess)
      .innerJoin(
        userOrgMappingTable,
        and(
          eq(userOrgMappingTable.userId, vwUserOrgAccess.userId),
          eq(userOrgMappingTable.orgId, vwUserOrgAccess.orgId),
        ),
      )
      .where(eq(vwUserOrgAccess.userId, userId))
      .orderBy(desc(vwUserOrgAccess.grantedAt)),
  );
}

export async function orgExists(orgId: string): Promise<boolean> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1 FROM entity.organizations WHERE id = ${orgId}::uuid AND NOT is_deleted
    `)) as Array<Record<string, unknown>>;
    return rows.length > 0;
  });
}

export async function roleExists(roleId: string): Promise<boolean> {
  return withServiceTx(async (tx) => {
    const [row] = await tx
      .select({ id: userRolesTable.id })
      .from(userRolesTable)
      .where(eq(userRolesTable.id, roleId))
      .limit(1);
    return !!row;
  });
}

export async function addOrgMapping(ctx: RoleTxContext, targetUserId: string, data: AddOrgMappingInput) {
  return withServiceTx(async (tx) => {
    const [row] = await tx
      .insert(userOrgMappingTable)
      .values({
        userId: targetUserId,
        orgId: data.org_id,
        roleId: data.role_id,
        leadAssignmentWeight: data.lead_assignment_weight ?? 0,
        grantedBy: ctx.user_id,
      })
      .onConflictDoUpdate({
        target: [userOrgMappingTable.userId, userOrgMappingTable.orgId],
        set: {
          roleId: data.role_id,
          isActive: true,
          leadAssignmentWeight: data.lead_assignment_weight ?? 0,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  });
}

export async function removeOrgMapping(targetUserId: string, orgId: string): Promise<boolean> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      UPDATE iam.user_org_mapping SET is_active = false, updated_at = NOW()
      WHERE user_id = ${targetUserId}::uuid AND org_id = ${orgId}::uuid
      RETURNING user_id
    `)) as Array<{ user_id: string }>;
    return rows.length > 0;
  });
}
