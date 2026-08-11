import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { RoleTxContext } from '@platform/db';
import { toApiRow, toApiRows } from '@platform/db';
import { ROLE_RANK } from '@platform/auth-constants';
import type { UserRole } from '@platform/auth-constants';
import { canGrantRole, canManageUser, canOverridePasswordPolicy, canSeeOrgFilter, checkMoveUserBranchAccess } from '@platform/authz';
import { ANCHOR_RANK } from '@platform/rbac';
import { createStrongPasswordSchema } from '@platform/validation';
import type { CreateUserInput, UpdateUserInput, ResetPasswordInput, AddOrgMappingInput, OrgAssignmentInput } from '@platform/validation';
import { NotFoundError, ConflictError, ForbiddenError, BadRequestError } from '../../../lib/errors.js';
import { logActivity } from '@platform/audit-log';
import { revokeAllUserSessions } from '../../../lib/jwt.js';
import { clearLockout } from '../auth/auth.repository.js';
import { config } from '../../../config/index.js';
import * as repo from './users.repository.js';
import type { UpdateUserFields } from './users.repository.js';

function generateTemporaryPassword(): string {
  return randomBytes(16).toString('base64url');
}

// Absolute floor for a tenant-wide admin's policy override — still a real
// minimum, just far below the default strength policy, so an override can
// never be used to set an effectively empty password.
const passwordOverrideFloorSchema = z.string().min(5, 'Password must be at least 5 characters').max(128, 'Password must be at most 128 characters');

/**
 * Turns a unique-violation from iam.users into a 409 naming the field that
 * actually collided, a row-level-security denial into a clean 403, and
 * returns anything else untouched for the caller to rethrow.
 *
 * Both email and mobile are unique now (mobile via uix_users_mobile, since it
 * is a login credential), so a single "email already exists" message would send
 * an admin hunting for the wrong duplicate.
 *
 * drizzle-orm's DrizzleQueryError sets its own `message` to just "Failed
 * query: ...params: ..." — the driver's actual Postgres error (unique
 * violation, RLS denial, etc.) is only on `.cause.message`. Checking `err`'s
 * own `.message` alone never matches, so every constraint/policy violation
 * fell through as an unhandled 500 leaking the raw query/params to the
 * client instead of a clean 409/403.
 */
function asDuplicateUserConflict(err: unknown): unknown {
  const causeMsg = (err as { cause?: { message?: string } })?.cause?.message ?? '';
  const msg = `${(err as Error)?.message ?? ''} ${causeMsg}`;
  if (msg.includes('uix_users_mobile')) {
    return new ConflictError('A user with this mobile number already exists.');
  }
  if (msg.includes('unique') || msg.includes('uq_users') || msg.includes('users_email_key')) {
    return new ConflictError('A user with this email already exists.');
  }
  if (msg.includes('row-level security policy')) {
    return new ForbiddenError('You do not have permission to grant access in this organisation.');
  }
  return err;
}

// Resolve the rank of a role name, rejecting unknown roles. Used to enforce the
// rank ceiling so an actor cannot grant a role above their own.
//
// Only the LEGACY role_name path uses this, and it is why that path cannot see
// tenant-defined roles: ROLE_RANK is a fixed nine-entry map, so a custom
// department role resolves to `undefined` and is rejected as unknown. The
// org_assignments path resolves rank from iam.user_roles instead — see
// resolveAssignments below.
function rankForRole(roleName: string): number {
  const rank = ROLE_RANK[roleName as UserRole];
  if (rank === undefined) throw new BadRequestError(`Unknown role: ${roleName}`);
  return rank;
}

/**
 * Validate an org_assignments payload against the actor's authority and the
 * tenant's own data, returning assignments the repository can apply as-is.
 *
 * Everything the request asserts is re-derived here from the database:
 *  - every branch is a live org of the ACTOR's tenant (never the caller's word);
 *  - every role id exists, is active, and belongs to that same tenant — the
 *    reason roles are addressed by id is that names are only unique per tenant;
 *  - every role sits at or below the actor's own rank, so an admin cannot
 *    promote someone past themselves in any branch, not just the home one;
 *  - assigning outside the actor's own branch needs branch-move authority.
 *
 * Fails as a whole. A partially-applied assignment list would leave a user with
 * access they were never meant to have in one branch and none in another.
 */
async function resolveAssignments(
  ctx: RoleTxContext,
  actorRank: number,
  assignments: OrgAssignmentInput[],
): Promise<repo.ResolvedAssignment[]> {
  const orgIds = assignments.map((a) => a.org_id);
  const roleIds = [...new Set(assignments.map((a) => a.role_id))];
  const tenantId = await resolveTenantId(ctx);

  const [orgs, roles] = await Promise.all([
    repo.getOrgsInTenant(orgIds, tenantId),
    repo.getRolesByIdsForTenant(roleIds, tenantId),
  ]);

  const knownOrgs = new Set(orgs.map((o) => o.id));
  const missingOrgs = orgIds.filter((id) => !knownOrgs.has(id));
  if (missingOrgs.length > 0) {
    throw new BadRequestError(`Branch not found in this tenant: ${missingOrgs.join(', ')}`);
  }

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const missingRoles = roleIds.filter((id) => !roleById.has(id));
  if (missingRoles.length > 0) {
    throw new BadRequestError(`Role not found in this tenant: ${missingRoles.join(', ')}`);
  }

  // Assigning a user to a branch other than the actor's own is the same
  // authority as moving them there, so it takes the same guard.
  const foreign = orgIds.filter((id) => id !== ctx.org_id);
  if (foreign.length > 0 && !checkMoveUserBranchAccess(ctx.role)) {
    throw new ForbiddenError('You cannot assign a user to a different branch');
  }

  for (const a of assignments) {
    const role = roleById.get(a.role_id)!;
    if (!canGrantRole(actorRank, role.rank)) {
      throw new ForbiddenError('You cannot grant a role higher than your own');
    }
  }

  return assignments.map((a) => ({
    org_id:  a.org_id,
    role_id: a.role_id,
    ...(a.lead_assignment_weight !== undefined ? { lead_assignment_weight: a.lead_assignment_weight } : {}),
  }));
}

// super_admin is the one global, tenant-less role (packages/rbac/src/ranks.ts),
// so its session never carries a real ctx.tenant_id — but it always carries a
// real ctx.org_id, and every org belongs to exactly one tenant. Resolving
// through org_id (same pattern as orgs.repository.ts's getAllOrgs) lets
// tenant-scoped lookups work for org_admin/tenant_admin/super_admin alike,
// instead of 500ing when the tenant_id header is empty.
async function resolveTenantId(ctx: RoleTxContext): Promise<string> {
  if (ctx.tenant_id) return ctx.tenant_id;
  const tenantId = await repo.getTenantIdForOrg(ctx.org_id);
  if (!tenantId) throw new BadRequestError('Could not resolve a tenant for this session');
  return tenantId;
}

export async function getRoleCatalog(ctx: RoleTxContext, actorRank: number) {
  const tenantId = await resolveTenantId(ctx);
  const [roles, departments] = await Promise.all([
    repo.getRoleCatalog(tenantId, actorRank),
    repo.getDepartmentsForTenant(tenantId),
  ]);

  return {
    roles: toApiRows(roles),
    departments,
  };
}

export async function getManagerCandidates(ctx: RoleTxContext, orgId: string) {
  const tenantId = await resolveTenantId(ctx);
  const [org] = await repo.getOrgsInTenant([orgId], tenantId);
  if (!org) throw new BadRequestError('Branch not found in this tenant');
  return toApiRows(await repo.getManagerCandidates(tenantId, orgId));
}

// Blocks acting on a user who currently outranks the actor (RLS only isolates by
// org/tenant, not by rank, so this guard is required). Also returns the target's
// own org_id so callers can scope subsequent writes to it rather than the
// actor's org — the actor and target may sit in different orgs under the same
// tenant (see updateUser's targetCtx for the original instance of this pattern).
async function assertCanManageTarget(
  actorRank: number,
  targetUserId: string,
): Promise<{ targetRank: number; targetOrgId: string }> {
  const target = await repo.getUserByIdAsService(targetUserId);
  if (!target) throw new NotFoundError('User not found');
  const targetRank = Number((target as Record<string, unknown>)['rank'] ?? 0);
  if (!canManageUser(actorRank, targetRank)) {
    throw new ForbiddenError('You cannot manage a user with a higher role');
  }
  const targetOrgId = (target as Record<string, unknown>)['org_id'] as string;
  return { targetRank, targetOrgId };
}

export async function listUsers(
  ctx: RoleTxContext,
  actorRank: number,
  page: number,
  pageSize: number,
  orgId?: string,
) {
  // Only actors whose scope actually crosses orgs (tenant admin+) may look up another
  // org's users — same threshold as the Leads History org filter. Anyone else's org_id
  // param is ignored and they get their own org, same as before this param existed.
  const canQueryOtherOrg = canSeeOrgFilter(ctx.role);
  const effectiveOrgId = orgId && canQueryOtherOrg ? orgId : undefined;
  // Tenant admin+ with no explicit org_id sees every branch in the tenant, not just
  // their own — mirrors the Leads History "tenant" scope instead of silently
  // defaulting to a single org.
  const tenantWide = canQueryOtherOrg && !effectiveOrgId;
  return repo.listUsers(ctx, actorRank, page, pageSize, effectiveOrgId, tenantWide);
}

export async function getUserById(ctx: RoleTxContext, targetUserId: string) {
  const user = await repo.getUserById(ctx, targetUserId);
  if (!user) throw new NotFoundError('User not found');
  return user;
}

export async function getAssignableUsers(
  ctx: RoleTxContext,
  actorRank: number,
  product: 'lms' | 'tasks',
  orgId?: string,
  scope: 'delegation' | 'collaboration' = 'delegation',
  maxRank?: number,
) {
  // Same threshold as listUsers' org filter — only actors who can already see
  // other branches may request assignable candidates for one of them (e.g. the
  // walk-in-lead form's org picker on the Assignments page).
  const canQueryOtherOrg = canSeeOrgFilter(ctx.role);
  const effectiveOrgId = orgId && canQueryOtherOrg ? orgId : undefined;
  // Same as listUsers: tenant admin+ with no explicit org_id sees candidates
  // across every branch in the tenant, not just their own — a caller whose
  // Leads History scope is 'tenant'/'all' but who hasn't picked a branch yet
  // should get the full candidate list, not silently just their home org's.
  const tenantWide = canQueryOtherOrg && !effectiveOrgId;
  return repo.getAssignableUsers(ctx, actorRank, product, effectiveOrgId, scope, maxRank, tenantWide);
}

export async function getAssignmentWeights(ctx: RoleTxContext, orgId?: string) {
  // Reading another branch's weights is the same visibility as the cross-org
  // filter on the roster, so it takes the same guard — and the org must be in
  // the actor's own tenant, checked against the database rather than trusted.
  if (orgId !== undefined && orgId !== ctx.org_id) {
    if (!canSeeOrgFilter(ctx.role)) {
      throw new ForbiddenError('You cannot view lead assignment weights for another branch');
    }
    const [org] = await repo.getOrgsInTenant([orgId], await resolveTenantId(ctx));
    if (!org) throw new BadRequestError('Branch not found in this tenant');
  }
  return repo.getAssignmentWeights(ctx, orgId);
}

export async function updateAssignmentWeights(
  ctx: RoleTxContext,
  weights: Array<{ user_id: string; weight: number }>,
) {
  await repo.updateAssignmentWeights(ctx, weights);
  await logActivity({ action_type: 'assignment_weights_updated', performed_by: ctx.user_id, org_id: ctx.org_id });
}

export async function getTeamMembers(ctx: RoleTxContext) {
  return repo.getTeamMembers(ctx);
}

export async function getOrgChart(ctx: RoleTxContext) {
  return repo.getOrgChart(ctx);
}

export async function createUser(ctx: RoleTxContext, actorRank: number, data: CreateUserInput) {
  // Multi-branch path: every branch/role pair is validated against the tenant
  // and the actor's ceiling before anything is written.
  const resolved = data.org_assignments
    ? await resolveAssignments(ctx, actorRank, data.org_assignments)
    : null;

  const homeOrgId = resolved ? data.home_org_id! : ctx.org_id;

  // Legacy path keeps its own ceiling check against the fixed rank map.
  if (!resolved) {
    if (!canGrantRole(actorRank, rankForRole(data.role_name!))) {
      throw new ForbiddenError('You cannot grant a role higher than your own');
    }
  }

  // A manager must be an active member of the branch the new user calls home.
  // iam.check_reporting_line_membership() enforces this anyway, but catching it
  // here turns a raw trigger exception into an answerable 400.
  //
  // Rank > 980 (tenant_admin/super_admin) is the deliberate exception: they
  // manage across branches by design, and the repository grants them the
  // mapping the trigger requires rather than refusing the request.
  let managerGrantedInHome = false;
  if (data.manager_id) {
    const isMember = await repo.isActiveOrgMember(ctx, data.manager_id, homeOrgId);
    if (!isMember) {
      const manager = await repo.getUserByIdAsService(data.manager_id);
      const managerRank = Number((manager as Record<string, unknown> | null)?.['rank'] ?? -1);
      if (managerRank <= ANCHOR_RANK.ORG_ADMIN) {
        throw new BadRequestError(
          'Selected manager is not an active member of this branch. Add them to this branch first.',
        );
      }
      managerGrantedInHome = true;
    }
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, config.bcryptRounds);

  try {
    const result = await repo.createUser(ctx, {
      first_name: data.first_name,
      ...(data.middle_name !== undefined ? { middle_name: data.middle_name } : {}),
      ...(data.last_name !== undefined ? { last_name: data.last_name } : {}),
      email: data.email,
      ...(data.mobile !== undefined ? { mobile: data.mobile } : {}),
      ...(data.role_name !== undefined ? { role_name: data.role_name } : {}),
      ...(data.manager_id !== undefined ? { manager_id: data.manager_id } : {}),
      ...(data.force_password_change !== undefined ? { force_password_change: data.force_password_change } : {}),
      password_hash: passwordHash,
      ...(resolved ? { org_assignments: resolved, home_org_id: homeOrgId } : {}),
    });

    await logActivity({
      action_type: 'user_created',
      performed_by: ctx.user_id,
      subject_user_id: result.id,
      org_id: homeOrgId,
      new_value: {
        email: data.email,
        ...(data.role_name ? { role: data.role_name } : {}),
        ...(resolved ? { branches: resolved.map((a) => a.org_id), home_org_id: homeOrgId } : {}),
      },
    });

    return {
      id: result.id,
      email: data.email,
      temporary_password: temporaryPassword,
      manager_granted_in_home_org: managerGrantedInHome,
    };
  } catch (err) {
    throw asDuplicateUserConflict(err);
  }
}

export async function updateUser(ctx: RoleTxContext, actorRank: number, targetUserId: string, data: UpdateUserInput) {
  const beforeUser = await repo.getUserByIdAsService(targetUserId);
  if (!beforeUser) throw new NotFoundError('User not found');

  // Cannot modify a user who currently outranks the actor.
  const currentRank = Number((beforeUser as Record<string, unknown>)['rank'] ?? 0);
  if (!canManageUser(actorRank, currentRank)) {
    throw new ForbiddenError('You cannot manage a user with a higher role');
  }

  // Cannot promote a user to a role above the actor's own rank.
  if (data.role_name !== undefined && !canGrantRole(actorRank, rankForRole(data.role_name))) {
    throw new ForbiddenError('You cannot grant a role higher than your own');
  }

  if (data.reassign_leads_to !== undefined && data.org_id === undefined && data.is_active !== false) {
    throw new BadRequestError('reassign_leads_to can only be set together with org_id, or when deactivating a user');
  }

  const fields: UpdateUserFields = {};
  if (data.first_name !== undefined)            fields.first_name = data.first_name;
  if (data.last_name !== undefined)             fields.last_name = data.last_name;
  if (data.middle_name !== undefined)           fields.middle_name = data.middle_name;
  if (data.email !== undefined)                 fields.email = data.email;
  if (data.mobile !== undefined)                fields.mobile = data.mobile;
  if (data.is_active !== undefined)             fields.is_active = data.is_active;
  if (data.force_password_change !== undefined) fields.force_password_change = data.force_password_change;
  if (data.manager_id !== undefined)            fields.manager_id = data.manager_id;

  // Resolved before the role lookup: roles are tenant-owned, so the role name
  // only identifies a row once you know which tenant — and that comes from the
  // org this user actually sits in, not the actor's.
  const targetOrgId = (beforeUser as Record<string, unknown> | null)?.['org_id'] as string ?? ctx.org_id;
  const targetCtx: RoleTxContext = { ...ctx, org_id: targetOrgId };

  if (data.role_name !== undefined) {
    const roleRow = await repo.resolveRoleByName(data.role_name, targetOrgId);
    if (!roleRow) throw new NotFoundError(`Role not found: ${data.role_name}`);
    fields.role_id = roleRow.id;
    fields.password_changed_at = new Date();
  }

  // Same membership rule as on create, checked against the org the target user
  // actually sits in rather than the actor's current one.
  if (data.manager_id) {
    if (data.manager_id === targetUserId) {
      throw new BadRequestError('A user cannot report to themselves');
    }
    if (!(await repo.isActiveOrgMember(targetCtx, data.manager_id, targetOrgId))) {
      throw new BadRequestError(
        'Selected manager is not an active member of this organisation. Add them to this branch first.',
      );
    }
  }

  // fields may legitimately be empty (e.g. an org-only branch move below) — don't
  // treat "nothing to SET" as "user not found"; only call the generic UPDATE when
  // there's something for it to do.
  if (Object.keys(fields).length > 0) {
    // email and mobile are both unique, so an edit can collide with another
    // user exactly as a create can -- without this the constraint surfaced as
    // a raw 500.
    let result;
    try {
      result = await repo.updateUser(targetCtx, targetUserId, fields, targetOrgId);
    } catch (err) {
      throw asDuplicateUserConflict(err);
    }
    if (!result) throw new NotFoundError('User not found');
  }

  if (fields.role_id !== undefined) {
    await repo.syncOrgMappingRole(targetCtx, targetUserId, fields.role_id);
  }

  // ── Multi-branch reconcile ────────────────────────────────────────────────
  // Supersedes the legacy single-org move below: when the caller sends the full
  // branch list, home comes from home_org_id and `org_id` is ignored entirely.
  if (data.org_assignments) {
    const resolved = await resolveAssignments(ctx, actorRank, data.org_assignments);
    const newHomeOrgId = data.home_org_id!;
    const homeAssignment = resolved.find((a) => a.org_id === newHomeOrgId)!;
    const homeMoved = newHomeOrgId !== targetOrgId;
    const stillHoldsOldOrg = resolved.some((a) => a.org_id === targetOrgId);

    // Home moving OUT of a branch the user is also leaving strands their open
    // leads there, so it takes the reassign-then-move saga. Home moving between
    // branches they keep leaves nothing behind — a plain pointer update.
    if (homeMoved && !stillHoldsOldOrg) {
      if (!checkMoveUserBranchAccess(ctx.role)) {
        throw new ForbiddenError('You cannot move a user to a different branch');
      }
      await repo.moveUserBranch(
        ctx, targetUserId, targetOrgId, newHomeOrgId, homeAssignment.role_id, data.reassign_leads_to,
      );
    } else if (homeMoved || homeAssignment.role_id !== (beforeUser as Record<string, unknown>)['role_id']) {
      await repo.setHomeOrg(targetUserId, newHomeOrgId, homeAssignment.role_id);
    }

    const reconcile = await repo.reconcileOrgAssignments(
      ctx, targetUserId, resolved, data.manager_id, newHomeOrgId,
    );

    await logActivity({
      action_type: 'user_org_access_changed',
      performed_by: ctx.user_id,
      subject_user_id: targetUserId,
      org_id: newHomeOrgId,
      old_value: { home_org_id: targetOrgId },
      new_value: {
        home_org_id: newHomeOrgId,
        added: reconcile.added,
        updated: reconcile.updated,
        removed: reconcile.removed,
        ...(reconcile.managerGrantedInOrg ? { manager_granted_in_org: reconcile.managerGrantedInOrg } : {}),
      },
    });

    // Same contract as the legacy path: rank and org_id are baked into the JWT,
    // so a branch or role change must not survive in an unrevoked token.
    if (homeMoved || reconcile.updated.length > 0 || reconcile.removed.length > 0) {
      await revokeAllUserSessions(targetUserId, {
        revokedBy: ctx.user_id,
        reason: homeMoved ? 'branch_changed' : 'role_changed',
      });
    }

    if (data.is_active === false) {
      await logActivity({ action_type: 'user_deactivated', performed_by: ctx.user_id, subject_user_id: targetUserId, org_id: newHomeOrgId });
      await revokeAllUserSessions(targetUserId, { revokedBy: ctx.user_id, reason: 'user_deactivated' });
    }
    return;
  }

  const isMovingBranch = data.org_id !== undefined && data.org_id !== targetOrgId;
  let branchMove: { newOrgName: string; reassignedLeadsCount: number } | null = null;
  if (isMovingBranch) {
    if (!checkMoveUserBranchAccess(ctx.role)) {
      throw new ForbiddenError('You cannot move a user to a different branch');
    }
    const roleId = fields.role_id ?? (beforeUser as Record<string, unknown>)['role_id'] as string;
    branchMove = await repo.moveUserBranch(ctx, targetUserId, targetOrgId, data.org_id!, roleId, data.reassign_leads_to);
  }

  // Deactivation, role changes, and branch moves are baked into the JWT (is_active
  // is not, but rank/org_id are), so an unrevoked token keeps the old privileges
  // until it expires. Force the target to re-authenticate so the change takes
  // effect immediately across all services.
  if (data.is_active === false || data.role_name !== undefined || isMovingBranch) {
    await revokeAllUserSessions(targetUserId, {
      revokedBy: ctx.user_id,
      reason: data.is_active === false ? 'user_deactivated' : isMovingBranch ? 'branch_changed' : 'role_changed',
    });
  }

  // A deactivated user can no longer log in, so any leads still open in their
  // hands need a new owner — reassign within the SAME org (deactivation never
  // moves a branch; that's isMovingBranch's job, which already handled its own
  // reassignment above if requested).
  let deactivationReassignedCount = 0;
  if (data.is_active === false && !isMovingBranch && data.reassign_leads_to) {
    deactivationReassignedCount = await repo.reassignUserLeadsInOrg(ctx, targetUserId, targetOrgId, data.reassign_leads_to);
  }

  if (data.is_active === false) {
    await logActivity({
      action_type: 'user_deactivated',
      performed_by: ctx.user_id,
      subject_user_id: targetUserId,
      org_id: targetOrgId,
      ...(data.reassign_leads_to ? { new_value: { reassigned_to: data.reassign_leads_to, reassigned_leads: deactivationReassignedCount } } : {}),
    });
  } else if (data.is_active === true) {
    await logActivity({ action_type: 'user_reactivated', performed_by: ctx.user_id, subject_user_id: targetUserId, org_id: targetOrgId });
  } else if (data.role_name !== undefined) {
    await logActivity({
      action_type: 'role_changed',
      performed_by: ctx.user_id,
      subject_user_id: targetUserId,
      org_id: targetOrgId,
      old_value: { role: (beforeUser as Record<string, unknown> | null)?.['role_name'] },
      new_value: { role: data.role_name },
    });
  } else if (Object.keys(fields).length > 0) {
    await logActivity({ action_type: 'user_updated', performed_by: ctx.user_id, subject_user_id: targetUserId, org_id: targetOrgId });
  }

  if (isMovingBranch) {
    await logActivity({
      action_type: 'user_branch_changed',
      performed_by: ctx.user_id,
      subject_user_id: targetUserId,
      org_id: data.org_id!,
      old_value: { org_id: targetOrgId },
      new_value: {
        org_id: data.org_id,
        branch_name: branchMove?.newOrgName,
        reassigned_leads: branchMove?.reassignedLeadsCount ?? 0,
      },
    });
  }
}

export async function deleteUser(ctx: RoleTxContext, actorRank: number, targetUserId: string) {
  await assertCanManageTarget(actorRank, targetUserId);
  await repo.softDeleteUser(ctx, targetUserId);
  await revokeAllUserSessions(targetUserId, { revokedBy: ctx.user_id, reason: 'user_deleted' });
  await logActivity({ action_type: 'user_deactivated', performed_by: ctx.user_id, subject_user_id: targetUserId, org_id: ctx.org_id });
}

export async function resetPassword(
  ctx: RoleTxContext,
  actorRank: number,
  targetUserId: string,
  data: ResetPasswordInput,
) {
  const { targetOrgId } = await assertCanManageTarget(actorRank, targetUserId);
  const targetCtx: RoleTxContext = { ...ctx, org_id: targetOrgId };

  // A policy override is only honored for tenant-wide roles, and only when
  // explicitly requested — everyone else always gets the full strength
  // policy, regardless of what override_policy says.
  const useOverrideFloor = data.override_policy === true && canOverridePasswordPolicy(ctx.role);
  if (data.new_password !== undefined) {
    const schema = useOverrideFloor
      ? passwordOverrideFloorSchema
      : createStrongPasswordSchema(config.passwordMinLength);
    const parsed = schema.safeParse(data.new_password);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]!.message);
  }

  const temporaryPassword = data.new_password ?? generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, config.bcryptRounds);

  // Written with targetCtx (target's own org), not the actor's ctx — the actor
  // may be a tenant-wide role managing a user in a different org, and scoping
  // the UPDATE to the actor's org would silently match zero rows there.
  const result = await repo.adminResetPassword(targetCtx, targetUserId, passwordHash);
  if (!result) throw new NotFoundError('User not found');

  // An admin reset is also the unlock path for a user locked out by failed
  // logins — otherwise the new temporary password would still be refused.
  await clearLockout(targetUserId);

  // Force the target's existing sessions to end immediately so a reset (e.g.
  // after a compromise) actually locks the user out everywhere, not just at
  // /auth/me. The target holds no fresh token, so NOW() is the correct cutoff.
  await revokeAllUserSessions(targetUserId, {
    revokedBy: ctx.user_id,
    reason: 'password_reset_by_admin',
  });

  await logActivity({
    action_type: 'password_reset_by_admin',
    performed_by: ctx.user_id,
    subject_user_id: targetUserId,
    org_id: ctx.org_id,
    ...(useOverrideFloor ? { new_value: { policy_override: true } } : {}),
  });

  return { temporary_password: temporaryPassword };
}

export async function listOrgMappings(targetUserId: string) {
  return toApiRows(await repo.listOrgMappings(targetUserId));
}

export async function addOrgMapping(
  ctx: RoleTxContext,
  actorRank: number,
  targetUserId: string,
  data: AddOrgMappingInput,
) {
  // Blocks granting/revoking access for a user who currently outranks the actor.
  await assertCanManageTarget(actorRank, targetUserId);

  const orgOk = await repo.orgExists(data.org_id);
  if (!orgOk) throw new NotFoundError('Organization not found');
  const roleOk = await repo.roleExists(data.role_id);
  if (!roleOk) throw new NotFoundError('Role not found');

  const row = await repo.addOrgMapping(ctx, targetUserId, data);

  await logActivity({
    action_type: 'user_org_mapping_added',
    performed_by: ctx.user_id,
    subject_user_id: targetUserId,
    org_id: data.org_id,
    new_value: { org_id: data.org_id, role_id: data.role_id },
  });

  return toApiRow(row);
}

export async function removeOrgMapping(
  ctx: RoleTxContext,
  actorRank: number,
  targetUserId: string,
  orgId: string,
) {
  await assertCanManageTarget(actorRank, targetUserId);

  const removed = await repo.removeOrgMapping(targetUserId, orgId);
  if (!removed) throw new NotFoundError('Org mapping not found');

  // A revoked user's existing session must not keep using access that was just
  // pulled — force re-authentication immediately, same as role/branch changes.
  await revokeAllUserSessions(targetUserId, {
    revokedBy: ctx.user_id,
    reason: 'org_access_revoked',
  });

  await logActivity({
    action_type: 'user_org_mapping_removed',
    performed_by: ctx.user_id,
    subject_user_id: targetUserId,
    org_id: orgId,
  });
}
