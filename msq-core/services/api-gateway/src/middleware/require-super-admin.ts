import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Edge gate for the platform super_admin console routes (the /meta/* admin
 * surface served to lookup-admin): page/form mappings, page discovery, campaign
 * mapping and the lead pull.
 *
 * DEFENCE IN DEPTH, not the boundary. meta-conversion-api re-checks
 * RANKS.SUPER_ADMIN on every one of these, and RLS fences the rows to the
 * administered tenant. What this adds is that a non-super-admin's request is
 * refused HERE, before it spends a hop, a Graph API call or a database
 * transaction — and that a service which one day forgets its own check does not
 * silently open a cross-tenant admin surface.
 *
 * Gates on platform_role, the coarse role the gateway verified from the JWT —
 * the one identity claim the edge holds. Product capabilities are not resolved
 * here (see authPreHandler: each service resolves those from the DB), and
 * super_admin is the one tenant-less platform role, so it is the right claim
 * for a console that administers tenants other than the caller's own.
 *
 * Must run after authPreHandler, which populates request.userCtx.
 */
export async function superAdminGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.userCtx?.platform_role !== 'super_admin') {
    return reply.status(403).send({ error: 'Super admin only' });
  }
}
