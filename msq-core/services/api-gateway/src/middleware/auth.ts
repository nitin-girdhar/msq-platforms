import type { FastifyRequest, FastifyReply } from 'fastify';
import { AUTH_COOKIE_NAME } from '@platform/auth-constants';
import type { JwtPayload } from '@platform/types';
import { verifyJwtEdge } from '../lib/jwt-verify.js';
import type { UserContext } from '../lib/proxy.js';

declare module 'fastify' {
  interface FastifyRequest {
    userCtx?: UserContext;
  }
}

export async function authPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies[AUTH_COOKIE_NAME] ?? extractBearerToken(request);

  if (!token) {
    return reply.status(401).send({ error: 'Not authenticated' });
  }

  const result = await verifyJwtEdge(token);
  if (!result.ok) {
    const message = result.reason === 'expired' ? 'Session expired' : 'Invalid token';
    return reply.status(401).send({ error: message });
  }

  const payload = result.payload as JwtPayload;

  // P1.3 hard cutover: a token minted before the shrink has no platform_role.
  // Fail closed so its holder must re-authenticate and pick up a shrunk token,
  // rather than silently defaulting to some role.
  if (!payload.platform_role) {
    return reply.status(401).send({ error: 'Session expired' });
  }

  request.userCtx = {
    user_id: payload.sub,
    platform_role: payload.platform_role,
    org_id: payload.org_id,
    tenant_id: payload.tenant_id,
  };
}

function extractBearerToken(request: FastifyRequest): string | undefined {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return undefined;
}
