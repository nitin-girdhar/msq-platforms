import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { RoleTxContext } from '@platform/db';
import { toApiRow, toApiRows } from '@platform/db';
import { ROLE_RANK } from '@platform/auth-constants';
import type { UserRole } from '@platform/auth-constants';
import { canGrantRole, canManageUser, canSeeOrgFilter, checkMoveUserBranchAccess } from '@platform/authz';
import type { CreateUserInput, UpdateUserInput, ResetPasswordInput, AddOrgMappingInput } from '@platform/validation';
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

// Resolve the rank of a role name, rejecting unknown roles. Used to enforce the
// rank ceiling so an actor cannot grant a role above their own.
function rankForRole(roleName: string): number {
  const rank = ROLE_RANK[roleName as UserRole];
  if (rank === undefined) throw new BadRequestError(`Unknown role: ${roleName}`);
  return rank;
}

// Blocks acting on a user who currently outranks the actor (RLS only isolates by
// org/tenant, not by rank, so this guard is required).
async function assertCanManageTarget(actorRank: number, targetUserId: string): Promise<number> {
  const target = await repo.getUserByIdAsService(targetUserId);
  if (!target) throw new NotFoundError('User not found');
  const targetRank = Number((target as Record<string, unknown>)['rank'] ?? 0);
  if (!canManageUser(actorRank, targetRank)) {
    throw new ForbiddenError('You cannot manage a user with a higher role');
  }
  return targetRank;
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

export async function getAssignableUsers(ctx: RoleTxContext, actorRank: number, orgId?: string) {
  // Same threshold as listUsers' org filter — only actors who can already see
  // other branches may request assignable candidates for one of them (e.g. the
  // walk-in-lead form's org picker on the Assignments page).
  const canQueryOtherOrg = canSeeOrgFilter(ctx.role);
  const effectiveOrgId = orgId && canQueryOtherOrg ? orgId : undefined;
  return repo.getAssignableUsers(ctx, actorRank, effectiveOrgId);
}

export async function getAssignmentWeights(ctx: RoleTxContext) {
  return repo.getAssignmentWeights(ctx);
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
  // Rank ceiling: an actor can never create a user whose role outranks them.
  if (!canGrantRole(actorRank, rankForRole(data.role_name))) {
    throw new ForbiddenError('You cannot grant a role higher than your own');
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
      role_name: data.role_name,
      ...(data.manager_id !== undefined ? { manager_id: data.manager_id } : {}),
      ...(data.force_password_change !== undefined ? { force_password_change: data.force_password_change } : {}),
      password_hash: passwordHash,
    });

    await logActivity({
      action_type: 'user_created',
      performed_by: ctx.user_id,
      subject_user_id: result.id,
      org_id: ctx.org_id,
      new_value: { email: data.email, role: data.role_name },
    });

    return { id: result.id, email: data.email, temporary_password: temporaryPassword };
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('uq_users')) {
      throw new ConflictError('A user with this email already exists.');
    }
    throw err;
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

  if (data.role_name !== undefined) {
    const roleRow = await repo.resolveRoleByName(data.role_name);
    if (!roleRow) throw new NotFoundError(`Role not found: ${data.role_name}`);
    fields.role_id = roleRow.id;
    fields.password_changed_at = new Date();
  }

  const targetOrgId = (beforeUser as Record<string, unknown> | null)?.['org_id'] as string ?? ctx.org_id;
  const targetCtx: RoleTxContext = { ...ctx, org_id: targetOrgId };

  // fields may legitimately be empty (e.g. an org-only branch move below) — don't
  // treat "nothing to SET" as "user not found"; only call the generic UPDATE when
  // there's something for it to do.
  if (Object.keys(fields).length > 0) {
    const result = await repo.updateUser(targetCtx, targetUserId, fields);
    if (!result) throw new NotFoundError('User not found');
  }

  if (fields.role_id !== undefined) {
    await repo.syncOrgMappingRole(targetCtx, targetUserId, fields.role_id);
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
  await assertCanManageTarget(actorRank, targetUserId);
  const temporaryPassword = data.new_password ?? generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, config.bcryptRounds);

  const result = await repo.adminResetPassword(ctx, targetUserId, passwordHash);
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
