import type { FastifyRequest, FastifyReply } from 'fastify';
import { resolveMemberRole } from '@platform/db';

// P1.3 — communication-service is a stateless cross-product relay that does no
// authorization of its own (it trusts its caller). For the DIRECT user-facing
// send routes (today the LMS "contact this lead" feature), the gateway is the
// caller, so it enforces the send permission here: block read_only from using
// the org's SMTP/WhatsApp credentials. Preserves the exact prior guarantee
// (former MIN_RANK_TO_SEND = SE = 20) without giving the relay a DB connection.
// The rank is resolved from lms.member_roles server-side — never a client value.
//
// NOTE (transitional): keyed on LMS rank because these routes are LMS today.
// When other products send via communication, they call it service-to-service
// (bypassing this gateway route) after doing their own authorization.
const MIN_LMS_RANK_TO_SEND = 20; // LMS_RANKS.SE

export async function communicationSendGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ctx = request.userCtx;
  if (!ctx) return; // authPreHandler already rejected

  const { rank } = await resolveMemberRole('lms', ctx.user_id, ctx.org_id);
  if (rank < MIN_LMS_RANK_TO_SEND) {
    return reply.status(403).send({ error: 'Insufficient permissions to send communications' });
  }
}
