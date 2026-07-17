import type { FastifyRequest, FastifyReply } from 'fastify';
import * as service from './communication.service.js';
import { ForbiddenError } from '../../../lib/errors.js';
import type {
  SendEmailInput,
  SendWhatsAppTextInput,
  SendWhatsAppTemplateInput,
  SendCommunicationInput,
} from './communication.schema.js';

// Minimum rank permitted to send outbound email/WhatsApp. read_only (rank 0)
// users must never be able to use the org's SMTP/WhatsApp credentials.
const MIN_RANK_TO_SEND = 20; // RANKS.SE

function assertCanSend(request: FastifyRequest): void {
  if ((request.auth?.rank ?? 0) < MIN_RANK_TO_SEND) {
    throw new ForbiddenError('Insufficient permissions to send communications');
  }
}

export class CommunicationController {
  getStatus = async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = service.getStatus();
    return reply.send({ success: true, data });
  };

  sendEmail = async (request: FastifyRequest, reply: FastifyReply) => {
    assertCanSend(request);
    const { org_id, user_id, role, tenant_id } = request.auth;
    const input = request.body as SendEmailInput;
    const data = await service.sendEmail({ org_id, user_id, role, tenant_id }, input);
    return reply.send({ success: true, data });
  };

  sendWhatsAppText = async (request: FastifyRequest, reply: FastifyReply) => {
    assertCanSend(request);
    const { org_id, user_id, role, tenant_id } = request.auth;
    const input = request.body as SendWhatsAppTextInput;
    const data = await service.sendWhatsAppText({ org_id, user_id, role, tenant_id }, input);
    return reply.send({ success: true, data });
  };

  sendWhatsAppTemplate = async (request: FastifyRequest, reply: FastifyReply) => {
    assertCanSend(request);
    const { org_id, user_id, role, tenant_id } = request.auth;
    const input = request.body as SendWhatsAppTemplateInput;
    const data = await service.sendWhatsAppTemplate({ org_id, user_id, role, tenant_id }, input);
    return reply.send({ success: true, data });
  };

  send = async (request: FastifyRequest, reply: FastifyReply) => {
    assertCanSend(request);
    const { org_id, user_id, role, tenant_id } = request.auth;
    const input = request.body as SendCommunicationInput;
    const data = await service.send({ org_id, user_id, role, tenant_id }, input);
    return reply.send({ success: true, data });
  };

  // Public/partner API path. Authorization (scope), content gating, and the
  // tenant recipient allowlist are enforced upstream at the gateway; here we
  // only read the tenant context from headers and dispatch.
  publicSend = async (request: FastifyRequest, reply: FastifyReply) => {
    const input = request.body as SendCommunicationInput;
    const ctx = {
      org_id: String(request.headers['x-org-id'] ?? ''),
      user_id: String(request.headers['x-user-id'] ?? 'api_client'),
      role: 'api_client',
      tenant_id: String(request.headers['x-tenant-id'] ?? ''),
    };
    const data = await service.send(ctx, input);
    return reply.send({ success: true, data });
  };
}
