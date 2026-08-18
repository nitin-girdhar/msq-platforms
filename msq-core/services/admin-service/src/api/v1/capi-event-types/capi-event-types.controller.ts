import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './capi-event-types.service.js';
import type { CreateCapiEventTypeInput, UpdateCapiEventTypeInput } from './capi-event-types.schema.js';

export class CapiEventTypesController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.list();
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.create(request.body as CreateCapiEventTypeInput);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const data = await service.update(id, request.body as UpdateCapiEventTypeInput);
    return reply.send({ success: true, data });
  };
}
