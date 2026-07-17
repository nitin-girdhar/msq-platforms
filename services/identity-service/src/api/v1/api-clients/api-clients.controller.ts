import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@crm/permissions';
import type { CreateApiClientInput, UpdateApiClientInput } from '@crm/validation';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './api-clients.service.js';

// org_admin (branch admin) and above manage API credentials; org_admin is
// restricted server-side to their own branch (see resolveBranchScope in the
// service layer) — never trust a client-supplied org_ids/scope_all_orgs for them.
function requireApiClientAdmin(rank: number): void {
  if (rank < RANKS.ADMIN) {
    throw new ForbiddenError('Only branch admins and above can manage API clients');
  }
}

export class ApiClientsController {
  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    requireApiClientAdmin(rank);
    const data = request.body as CreateApiClientInput;
    const isOrgAdmin = rank < RANKS.TENANT_ADMIN;
    const result = await service.createApiClient({ org_id, user_id, role, tenant_id }, data, isOrgAdmin);
    return reply.status(201).header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    requireApiClientAdmin(rank);
    const clients = await service.listApiClients({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: clients });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    requireApiClientAdmin(rank);
    const { id } = request.params as { id: string };
    const data = request.body as UpdateApiClientInput;
    const isOrgAdmin = rank < RANKS.TENANT_ADMIN;
    const result = await service.updateApiClient({ org_id, user_id, role, tenant_id }, id, data, isOrgAdmin);
    return reply.header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  rotate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    requireApiClientAdmin(rank);
    const { id } = request.params as { id: string };
    const result = await service.rotateApiClient({ org_id, user_id, role, tenant_id }, id);
    return reply.header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  revoke = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    requireApiClientAdmin(rank);
    const { id } = request.params as { id: string };
    await service.revokeApiClient({ org_id, user_id, role, tenant_id }, id);
    return reply.status(204).send();
  };
}
