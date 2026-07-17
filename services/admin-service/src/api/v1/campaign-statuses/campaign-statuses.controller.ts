import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@crm/permissions';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './campaign-statuses.service.js';
import type { CreateCampaignStatusInput, UpdateCampaignStatusInput } from './campaign-statuses.schema.js';

export class CampaignStatusesController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.list();
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const body = request.body as CreateCampaignStatusInput;
    const data = await service.create(body);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const body = request.body as UpdateCampaignStatusInput;
    const data = await service.update(id, body);
    return reply.send({ success: true, data });
  };
}
