import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CreateUserInput, UpdateUserInput, ResetPasswordInput, UpdateAssignmentWeightsInput, AddOrgMappingInput } from '@platform/validation';
import { RANKS } from '@platform/authz';
import { hasCapability } from '@platform/db';
import { CAPABILITY, ANCHOR_RANK } from '@platform/rbac';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './users.service.js';
import type { ListUsersQuery, GetAssignableQuery } from './users.schema.js';

// User management runs on the GLOBAL iam.user_roles ladder (P1.1/P1.2), not on
// any single product's rank scale — identity is platform-shared and must not
// take a product-authz dependency (N-1). This threshold is numerically the
// same tier LMS calls "senior_sales_executive" (see lms.roles.rank), but it's
// inlined here rather than imported so identity-service takes no @lms/authz
// dependency. Matches the RANK_READ_ONLY/RANK_ADMIN inlining already used in
// users.repository.ts and packages/db/src/assignment.ts.
const USER_MGMT_MIN_RANK = 40;

// May this actor send the affected user a notification email for a Team action?
// The checkbox is opt-out (undefined = the admin left it ticked), ANDed with the
// admin.team.notify capability. The capability is authoritative for EVERY role,
// anchor roles included: unlike the admin.team.manage create-gate there is no
// per-tenant-copy blind spot to work around here — admin.team.notify ships with
// a back-fill pinned to admin.team.manage (03_roles_and_grants.sql, schema
// 1.46.0), so every role that can manage the team already holds it, and a tenant
// that unticks "Notify user by email" writes is_granted = FALSE that must be
// honoured. Purely an outbound-notification gate: never an RLS boundary, so it
// does not touch the write path at all — worst case is an email not sent.
async function mayNotify(
  sendFlag: boolean | undefined,
  tenantId: string,
  roleName: string | null,
): Promise<boolean> {
  if (sendFlag === false) return false;
  return hasCapability(tenantId, roleName ?? '', CAPABILITY.ADMIN_TEAM_NOTIFY);
}

export class UsersController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id, rank } = request.auth;
    if (rank < USER_MGMT_MIN_RANK) throw new ForbiddenError('Insufficient permissions to view iam.users');
    const q = request.query as ListUsersQuery;
    // role_name, not `role`: the scope ladder lives on the tenant-defined role
    // (iam.user_roles.name), which platform_role collapses to four values.
    const result = await service.listUsers(
      { org_id, user_id, role, tenant_id }, rank, q.page, q.page_size, q.org_id, q.scope, role_name,
    );
    return reply.send({ success: true, data: result.users, total: result.total, page: result.page, page_size: result.page_size, scope: result.scope });
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const { id } = request.params as { id: string };
    const user = await service.getUserById({ org_id, user_id, role, tenant_id }, id);
    return reply.send({ success: true, data: user });
  };

  getAssignable = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id, rank } = request.auth;
    const q = request.query as GetAssignableQuery;
    const users = await service.getAssignableUsers(
      { org_id, user_id, role, tenant_id }, role_name, rank, q.product, q.org_id, q.scope, q.max_rank, q.purpose, q.org_ids,
    );
    return reply.send({ success: true, data: users });
  };

  getAssignmentWeights = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const { org_id: queryOrgId } = request.query as { org_id?: string };
    const weights = await service.getAssignmentWeights({ org_id, user_id, role, tenant_id }, queryOrgId);
    return reply.send({ success: true, data: weights });
  };

  // Assignable roles for this tenant, already capped at the actor's own rank —
  // the dropdown cannot offer a role the write would refuse.
  getRoleCatalog = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < USER_MGMT_MIN_RANK) throw new ForbiddenError('Insufficient permissions to view roles');
    const data = await service.getRoleCatalog({ org_id, user_id, role, tenant_id }, rank);
    return reply.send({ success: true, data });
  };

  getManagerCandidates = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < USER_MGMT_MIN_RANK) throw new ForbiddenError('Insufficient permissions to view managers');
    const { org_id: queryOrgId } = request.query as { org_id?: string };
    const data = await service.getManagerCandidates({ org_id, user_id, role, tenant_id }, queryOrgId ?? org_id);
    return reply.send({ success: true, data });
  };

  updateAssignmentWeights = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only org admins can manage lead assignment weights');
    const data = request.body as UpdateAssignmentWeightsInput;
    await service.updateAssignmentWeights({ org_id, user_id, role, tenant_id }, data.weights);
    return reply.status(204).send();
  };

  getTeam = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const members = await service.getTeamMembers({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: members });
  };

  getOrgChart = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const chart = await service.getOrgChart({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: chart });
  };

  // Creating a user: an anchor admin, OR anyone holding lms.users.manage.
  //
  // This MIRRORS iam.fn_user_can_manage_users (db_scripts/04_functions_triggers.sql)
  // clause for clause, and the mirroring is the whole point — the two must not
  // be able to disagree. The SQL short-circuits on the effective role being
  // super_admin/tenant_admin/org_admin before it ever consults the matrix; this
  // check has to do the same or it becomes the stricter of the two and rejects
  // requests RLS would have allowed.
  //
  // The anchor half is NOT belt-and-braces, it is load-bearing: on a real
  // database `lms.users.manage` resolves FALSE for org_admin and tenant_admin.
  // reference_data/03_roles_and_grants.sql grants it to them on the global
  // template, but the ladder roles have been per-tenant COPIES since
  // _migrations/19, so template grants never reached existing tenants. Gating on
  // the matrix alone therefore locked every admin out of user creation. Rank
  // >= 980 is exactly those three roles (the dynamic band tops out at 979, see
  // packages/rbac/src/ranks.ts), so this is the same set the SQL names.
  //
  // The capability half is what the change is for: it lets a tenant delegate
  // user creation to a role BELOW 980 by ticking one box in the Capability
  // Matrix screen, which previously did nothing because RLS enforced 980
  // underneath. That grant now reaches all the way down to the INSERT.
  //
  // role_name is the GLOBAL role from resolveGlobalRole, while the SQL checks
  // the PER-ORG effective role. That is the deliberate fast-fail/authority split
  // can_assign_to and canAssignToUser already use: RLS decides, this saves a
  // round trip. Resolved through the same DB-cached matrix orgs.controller uses
  // rather than by importing @lms/authz — identity is platform-shared and takes
  // no product-authz dependency (N-1).
  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id, rank } = request.auth;
    const mayManageUsers = rank >= ANCHOR_RANK.ORG_ADMIN
      || await hasCapability(tenant_id, role_name, CAPABILITY.ADMIN_TEAM_MANAGE);
    if (!mayManageUsers) {
      throw new ForbiddenError('Insufficient permissions to create iam.users');
    }
    const data = request.body as CreateUserInput;
    const notify = await mayNotify(data.send_email_notification, tenant_id, role_name);
    const result = await service.createUser({ org_id, user_id, role, tenant_id }, rank, data, notify);
    return reply.status(201).header('Cache-Control', 'no-store').send({ success: true, data: { id: result.id, email: result.email }, temporary_password: result.temporary_password });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id, rank } = request.auth;
    if (rank < USER_MGMT_MIN_RANK) throw new ForbiddenError('Insufficient permissions to update iam.users');
    const { id } = request.params as { id: string };
    const data = request.body as UpdateUserInput;
    const notify = await mayNotify(data.send_email_notification, tenant_id, role_name);
    await service.updateUser({ org_id, user_id, role, tenant_id }, rank, id, data, notify);
    return reply.status(204).send();
  };

  delete = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Forbidden');
    const { id } = request.params as { id: string };
    await service.deleteUser({ org_id, user_id, role, tenant_id }, rank, id);
    return reply.status(204).send();
  };

  resetPassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can reset passwords');
    const { id } = request.params as { id: string };
    const data = request.body as ResetPasswordInput;
    const notify = await mayNotify(data.send_email_notification, tenant_id, role_name);
    const result = await service.resetPassword({ org_id, user_id, role, tenant_id }, rank, id, data, notify);
    return reply.header('Cache-Control', 'no-store').send({ success: true, data: { temporary_password: result.temporary_password } });
  };

  listOrgMappings = async (request: FastifyRequest, reply: FastifyReply) => {
    const { rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can view org mappings');
    const { id } = request.params as { id: string };
    const data = await service.listOrgMappings(id);
    return reply.send({ success: true, data });
  };

  addOrgMapping = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can grant org access');
    const { id } = request.params as { id: string };
    const data = request.body as AddOrgMappingInput;
    const result = await service.addOrgMapping({ org_id, user_id, role, tenant_id }, rank, id, data);
    return reply.status(201).send({ success: true, data: result });
  };

  removeOrgMapping = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can revoke org access');
    const { id, orgId } = request.params as { id: string; orgId: string };
    await service.removeOrgMapping({ org_id, user_id, role, tenant_id }, rank, id, orgId);
    return reply.status(204).send();
  };
}
