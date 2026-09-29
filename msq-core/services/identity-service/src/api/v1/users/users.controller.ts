import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CreateUserInput, UpdateUserInput, ResetPasswordInput, UpdateAssignmentWeightsInput, AddOrgMappingInput } from '@platform/validation';
import { RANKS } from '@platform/authz';
import { hasCapability } from '@platform/db';
import { CAPABILITY, ANCHOR_RANK } from '@platform/rbac';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './users.service.js';
import type { ListUsersQuery, GetAssignableQuery, AdminScopeQuery, OrgScopedQuery, AssignmentWeightsQuery } from './users.schema.js';

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
      { org_id, user_id, role, tenant_id }, rank, q.page, q.page_size, q.org_id, q.scope, role_name, q.tenant_id,
    );
    return reply.send({ success: true, data: result.users, total: result.total, page: result.page, page_size: result.page_size, scope: result.scope });
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const { id } = request.params as { id: string };
    const q = request.query as AdminScopeQuery;
    const user = await service.getUserById({ org_id, user_id, role, tenant_id }, id, q.tenant_id, q.org_id);
    return reply.send({ success: true, data: user });
  };

  getAssignable = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id, rank } = request.auth;
    const q = request.query as GetAssignableQuery;
    // Coverage (which branches) is resolved inside the scoped tenant; the org
    // ids themselves stay a NARROWING filter within it, as before.
    const { ctx } = await service.scopeContext({ org_id, user_id, role, tenant_id }, { tenant_id: q.tenant_id });
    const users = await service.getAssignableUsers(
      ctx, role_name, rank, q.product, q.org_id, q.scope, q.max_rank, q.purpose, q.org_ids,
    );
    return reply.send({ success: true, data: users });
  };

  getAssignmentWeights = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const { org_id: queryOrgId, campaign_type_id, tenant_id: scopeTenantId } = request.query as AssignmentWeightsQuery;
    const { ctx } = await service.scopeContext(
      { org_id, user_id, role, tenant_id }, { tenant_id: scopeTenantId, org_id: queryOrgId }, { requireOrg: true },
    );
    const weights = await service.getAssignmentWeights(ctx, queryOrgId, campaign_type_id);
    return reply.send({ success: true, data: weights });
  };

  // Read-through campaign-type catalog for OrgAssignmentsField, gated on the
  // same admin.team.manage-family rank check that guards reaching this router's
  // user-edit routes (USER_MGMT_MIN_RANK) — not leads-service's
  // LMS_CAMPAIGN_TYPES_VIEW, which not every admin.team.manage holder has (see
  // Phase 07 plan §4).
  getCampaignTypeCatalog = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < USER_MGMT_MIN_RANK) throw new ForbiddenError('Insufficient permissions to view campaign types');
    const q = request.query as OrgScopedQuery;
    const { ctx } = await service.scopeContext({ org_id, user_id, role, tenant_id }, { tenant_id: q.tenant_id });
    const data = await service.getCampaignTypeCatalog(ctx);
    return reply.send({ success: true, data });
  };

  // Assignable roles for this tenant, already capped at the actor's own rank —
  // the dropdown cannot offer a role the write would refuse.
  getRoleCatalog = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < USER_MGMT_MIN_RANK) throw new ForbiddenError('Insufficient permissions to view roles');
    const q = request.query as OrgScopedQuery;
    const { ctx } = await service.scopeContext({ org_id, user_id, role, tenant_id }, { tenant_id: q.tenant_id });
    const data = await service.getRoleCatalog(ctx, rank);
    return reply.send({ success: true, data });
  };

  getManagerCandidates = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < USER_MGMT_MIN_RANK) throw new ForbiddenError('Insufficient permissions to view managers');
    const q = request.query as OrgScopedQuery;
    const { ctx } = await service.scopeContext(
      { org_id, user_id, role, tenant_id }, { tenant_id: q.tenant_id, org_id: q.org_id }, { requireOrg: true },
    );
    const data = await service.getManagerCandidates(ctx, q.org_id ?? ctx.org_id);
    return reply.send({ success: true, data });
  };

  updateAssignmentWeights = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only org admins can manage lead assignment weights');
    const data = request.body as UpdateAssignmentWeightsInput;
    // Writes land in ctx.org_id. For super_admin that is the `org_id` named here
    // (required when working another tenant); for everyone else it stays their
    // session branch — a requested org_id never re-points an RLS-scoped actor.
    const q = request.query as OrgScopedQuery;
    const { ctx } = await service.scopeContext(
      { org_id, user_id, role, tenant_id }, { tenant_id: q.tenant_id, org_id: q.org_id }, { requireOrg: true },
    );
    await service.updateAssignmentWeights(ctx, data.weights);
    return reply.status(204).send();
  };

  getTeam = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const q = request.query as OrgScopedQuery;
    const { ctx } = await service.scopeContext(
      { org_id, user_id, role, tenant_id }, { tenant_id: q.tenant_id, org_id: q.org_id }, { requireOrg: true },
    );
    const members = await service.getTeamMembers(ctx);
    return reply.send({ success: true, data: members });
  };

  getOrgChart = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    // A super_admin reads any branch of the selected tenant's reporting tree
    // (lookup-admin's Team view); everyone else, their own branch as before.
    const q = request.query as OrgScopedQuery;
    const { ctx } = await service.scopeContext(
      { org_id, user_id, role, tenant_id }, { tenant_id: q.tenant_id, org_id: q.org_id }, { requireOrg: true },
    );
    const chart = await service.getOrgChart(ctx);
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
    const { tenant_id: scopeTenantId } = request.query as AdminScopeQuery;
    const result = await service.createUser({ org_id, user_id, role, tenant_id }, rank, data, notify, scopeTenantId);
    return reply.status(201).header('Cache-Control', 'no-store').send({
      success: true,
      // hr_profile_synced: false means the member exists but has no HR profile
      // yet (hr-service unreachable/rejected) — the form tells the admin.
      data: { id: result.id, email: result.email, hr_profile_synced: result.hr_profile_synced },
      temporary_password: result.temporary_password,
    });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id, rank } = request.auth;
    if (rank < USER_MGMT_MIN_RANK) throw new ForbiddenError('Insufficient permissions to update iam.users');
    const { id } = request.params as { id: string };
    const data = request.body as UpdateUserInput;
    const notify = await mayNotify(data.send_email_notification, tenant_id, role_name);
    // 200 with a body rather than 204: the admin needs to know when the member's
    // HR profile could not be kept in step (see syncHrProfile in the service).
    const { tenant_id: scopeTenantId } = request.query as AdminScopeQuery;
    const result = await service.updateUser({ org_id, user_id, role, tenant_id }, rank, id, data, notify, scopeTenantId);
    return reply.send({ success: true, data: result });
  };

  delete = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Forbidden');
    const { id } = request.params as { id: string };
    const { tenant_id: scopeTenantId } = request.query as AdminScopeQuery;
    await service.deleteUser({ org_id, user_id, role, tenant_id }, rank, id, scopeTenantId);
    return reply.status(204).send();
  };

  resetPassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can reset passwords');
    const { id } = request.params as { id: string };
    const data = request.body as ResetPasswordInput;
    const notify = await mayNotify(data.send_email_notification, tenant_id, role_name);
    const { tenant_id: scopeTenantId } = request.query as AdminScopeQuery;
    const result = await service.resetPassword({ org_id, user_id, role, tenant_id }, rank, id, data, notify, scopeTenantId);
    return reply.header('Cache-Control', 'no-store').send({ success: true, data: { temporary_password: result.temporary_password } });
  };

  listOrgMappings = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can view org mappings');
    const { id } = request.params as { id: string };
    const { tenant_id: scopeTenantId } = request.query as AdminScopeQuery;
    const data = await service.listOrgMappings({ org_id, user_id, role, tenant_id }, id, scopeTenantId);
    return reply.send({ success: true, data });
  };

  addOrgMapping = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can grant org access');
    const { id } = request.params as { id: string };
    const data = request.body as AddOrgMappingInput;
    const { tenant_id: scopeTenantId } = request.query as AdminScopeQuery;
    const result = await service.addOrgMapping({ org_id, user_id, role, tenant_id }, rank, id, data, scopeTenantId);
    return reply.status(201).send({ success: true, data: result });
  };

  removeOrgMapping = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can revoke org access');
    const { id, orgId } = request.params as { id: string; orgId: string };
    const { tenant_id: scopeTenantId } = request.query as AdminScopeQuery;
    await service.removeOrgMapping({ org_id, user_id, role, tenant_id }, rank, id, orgId, scopeTenantId);
    return reply.status(204).send();
  };
}
