import type { FastifyRequest, FastifyReply } from 'fastify';
import { capabilitiesFor } from '@platform/db';
import { resolveScope, CAPABILITY } from '@platform/rbac';
import * as service from './orgs.service.js';
import type { GetOrgsQuery, UpdateOrgGeoInput } from './orgs.schema.js';

export class OrgsController {
  getOrgs = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id } = request.auth;
    const q = request.query as GetOrgsQuery;
    // Cross-branch reach is a capability, not a hardcoded platform_role check —
    // this feeds the LMS branch dropdown, so it asks the same lms.leads.view
    // scope ladder leads-service gates the actual data on. identity-service's
    // request.auth doesn't carry a resolved capabilities array (unlike LMS
    // product services), so resolve it here via the same DB-cached matrix
    // filterRowsByCapability uses elsewhere in this service.
    const capabilities = await capabilitiesFor(tenant_id, role_name);
    const scope = resolveScope({ capabilities }, CAPABILITY.LMS_LEADS_VIEW);
    const isTenantWide = scope === 'tenant' || scope === 'all';
    const orgs = await service.getOrgs({ org_id, user_id, role, tenant_id }, {
      ...(q.cityIds.length    ? { cityIds:    q.cityIds }    : {}),
      ...(q.stateIds.length   ? { stateIds:   q.stateIds }   : {}),
      ...(q.countryIds.length ? { countryIds: q.countryIds } : {}),
    }, isTenantWide);
    return reply.send({ success: true, data: orgs });
  };

  getAllOrgs = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const orgs = await service.getAllOrgs({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: orgs });
  };

  getLeadSources = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const sources = await service.getLeadSources({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: sources });
  };

  updateOrgGeo = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    const { id } = request.params as { id: string };
    const updated = await service.updateOrgGeo({ org_id, user_id, role, tenant_id, rank }, id, request.body as UpdateOrgGeoInput);
    return reply.send({ success: true, data: updated });
  };
}
