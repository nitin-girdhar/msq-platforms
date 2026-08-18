import type { FastifyRequest, FastifyReply } from 'fastify';
import { resolveGlobalRole } from '@platform/db';
import { ANCHOR_RANK } from '@platform/rbac';

// Tier C — communication-service is a stateless cross-product relay that does no
// authorization of its own (it trusts its caller). For the DIRECT user-facing
// send routes (today the LMS "contact this lead" feature), the gateway is the
// caller, so it enforces the send permission here: block read_only from using
// the org's SMTP/WhatsApp credentials. Anyone with any active role above
// read_only (rank > 0) may send; read_only (rank 0) and users with no active
// role (rank -1) may not.
// The rank is resolved from the unified iam ladder server-side (never a client
// value) — the same resolver every other service's page guards use, so this
// stays in lockstep instead of reading a per-product scale that can drift.
//
// NOTE (transitional): these routes are LMS today, but the gate itself is now
// product-agnostic (the global rank, not an LMS-specific one). When other
// products send via communication, they call it service-to-service (bypassing
// this gateway route) after doing their own authorization.

export async function communicationSendGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ctx = request.userCtx;
  if (!ctx) return; // authPreHandler already rejected

  const { rank } = await resolveGlobalRole(ctx.user_id, ctx.org_id);
  if (rank <= ANCHOR_RANK.READ_ONLY) {
    return reply.status(403).send({ error: 'Insufficient permissions to send communications' });
  }
}
