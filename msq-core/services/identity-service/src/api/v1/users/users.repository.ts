import { sql, eq, and, desc } from 'drizzle-orm';
import { withRoleTx, withServiceTx } from '@platform/db';
import type { RoleTxContext } from '@platform/db';
import {
  usersTable,
  userRolesTable,
  userOrgMappingTable,
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

export async function getAssignmentWeights(ctx: RoleTxContext) {
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(sql`
      SELECT u.id AS user_id, u.full_name, u.email,
             ur.name AS role_name, ur.label AS role_label, ur.rank,
             uom.lead_assignment_weight AS weight
      FROM iam.user_org_mapping uom
      JOIN iam.users u       ON u.id  = uom.user_id
      JOIN iam.user_roles ur ON ur.id = uom.role_id
      WHERE uom.org_id = ${ctx.org_id}::uuid AND uom.is_active AND NOT u.is_deleted AND u.is_active
        AND ur.rank > ${RANK_READ_ONLY} AND ur.rank < ${RANK_ADMIN}
      ORDER BY ur.rank DESC, u.full_name
    `)) as Array<Record<string, unknown>>;
  });
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

export async function getAssignableUsers(
  ctx: RoleTxContext,
  actorRank: number,
  orgId?: string,
  scope: 'delegation' | 'collaboration' = 'delegation',
) {
  const targetOrgId = orgId ?? ctx.org_id;
  // delegation: strictly below the actor (CRM lead hand-down).
  // collaboration: at or below the actor, so same-rank peers and the actor
  // themselves are assignable (Tasks). See getAssignableQuerySchema.
  const rankFilter =
    scope === 'collaboration'
      ? sql`ur.rank <= ${actorRank}`
      : sql`ur.rank < ${actorRank}`;
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(sql`
      SELECT u.id, u.org_id, u.full_name, u.first_name, u.middle_name, u.last_name,
             u.email, u.is_active,
             ur.name AS role_name, ur.label AS role_label, ur.rank
      FROM iam.user_org_mapping uom
      JOIN iam.users u       ON u.id  = uom.user_id
      JOIN iam.user_roles ur ON ur.id = uom.role_id
      WHERE uom.org_id = ${targetOrgId}::uuid AND uom.is_active AND NOT u.is_deleted AND u.is_active
        AND ${rankFilter}
      ORDER BY ur.rank DESC, u.full_name
    `)) as Array<Record<string, unknown>>;
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

export interface CreateUserData {
  first_name: string;
  middle_name?: string;
  last_name?: string;
  email: string;
  // Normalized to E.164 by mobileInputSchema; null clears it.
  mobile?: string | null;
  role_name: string;
  manager_id?: string;
  force_password_change?: boolean;
  password_hash: string;
}

export async function resolveRoleByName(roleName: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx
      .select({ id: userRolesTable.id })
      .from(userRolesTable)
      .where(eq(userRolesTable.name, roleName))
      .limit(1);
    return row ?? null;
  });
}

export async function createUser(ctx: RoleTxContext, data: CreateUserData) {
  return withRoleTx(ctx, async (tx) => {
    const [roleRow] = await tx
      .select({ id: userRolesTable.id })
      .from(userRolesTable)
      .where(eq(userRolesTable.name, data.role_name))
      .limit(1);
    if (!roleRow) throw new BadRequestError(`Role not found: ${data.role_name}`);
    const roleId = roleRow.id;

    const rows = (await tx.execute(sql`
      INSERT INTO iam.users
        (org_id, first_name, middle_name, last_name, email, mobile, role_id,
         manager_id, password_hash, password_changed_at, is_active, force_password_change)
      VALUES (
        ${ctx.org_id}::uuid,
        ${data.first_name},
        ${data.middle_name ?? null},
        ${data.last_name ?? ''},
        ${data.email},
        ${data.mobile ?? null},
        ${roleId}::uuid,
        ${data.manager_id ? sql`${data.manager_id}::uuid` : sql`NULL`},
        ${data.password_hash},
        CLOCK_TIMESTAMP(),
        TRUE,
        ${data.force_password_change ?? true}
      )
      RETURNING id
    `)) as Array<{ id: string }>;
    const created = rows[0]!;

    await tx
      .insert(userOrgMappingTable)
      .values({
        userId:    created.id,
        orgId:     ctx.org_id,
        roleId,
        grantedBy: ctx.user_id,
      })
      .onConflictDoUpdate({
        target: [userOrgMappingTable.userId, userOrgMappingTable.orgId],
        set: { roleId, isActive: true, updatedAt: new Date() },
      });

    return created;
  });
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
    if (fields.manager_id !== undefined)          chunks.push(sql`manager_id = ${fields.manager_id}`);
    if (fields.role_id !== undefined)             chunks.push(sql`role_id = ${fields.role_id}::uuid`);
    if (fields.password_hash !== undefined)       chunks.push(sql`password_hash = ${fields.password_hash}`);
    if (fields.password_changed_at !== undefined) chunks.push(sql`password_changed_at = ${fields.password_changed_at.toISOString()}::timestamptz`);

    if (chunks.length === 0) return null;

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
  reassignTo: string,
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
      .select()
      .from(vwUserOrgAccess)
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
