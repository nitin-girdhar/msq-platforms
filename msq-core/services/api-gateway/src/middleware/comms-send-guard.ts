import type { FastifyRequest, FastifyReply } from 'fastify';
import { resolveMemberRole } from '@platform/db';

// P1.3 — communication-service is a stateless cross-product relay that does no
// authorization of its own (it trusts its caller). For the DIRECT user-facing
// send routes (today the LMS "contact this lead" feature), the gateway is the
// caller, so it enforces the send permission here: block read_only from using
// the org's SMTP/WhatsApp credentials. Anyone with any active role above
// read_only (rank > 0) may send; read_only (rank 0) and users with no active
// role (rank -1) may not. Not keyed on a specific product-rank tier, so it
// never drifts when a product re-ranks its ladder.
// The rank is resolved from lms.member_roles server-side — never a client value.
//
// NOTE (transitional): keyed on LMS rank because these routes are LMS today.
// When other products send via communication, they call it service-to-service
// (bypassing this gateway route) after doing their own authorization.

export async function communicationSendGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ctx = request.userCtx;
  if (!ctx) return; // authPreHandler already rejected

  const { rank } = await resolveMemberRole('lms', ctx.user_id, ctx.org_id);
  if (rank <= 0) {
    return reply.status(403).send({ error: 'Insufficient permissions to send communications' });
  }
}
