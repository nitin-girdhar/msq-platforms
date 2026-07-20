import type { FastifyRequest } from 'fastify';
import { readAuthContext, checkInternalSecret } from '@platform/service-auth';
import { UnauthorizedError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

// P1.3: communication-service is a stateless cross-product relay — it performs
// NO rank authorization (its caller does, and for direct user sends the gateway
// enforces the read_only send-block). It only needs the sender's identity to
// build the provider context, so no rank is resolved. `role` carries platform_role.
export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  const { org_id, user_id, tenant_id, platform_role } = result.auth;
  request.auth = { org_id, user_id, tenant_id, role: platform_role };
}

// Gateway-secret-only check for the public send path — the API key, scope, and
// recipient allowlist are all enforced at the gateway; here we only confirm the
// call came through the gateway and read the tenant from the injected headers.
export async function requireInternalSecret(request: FastifyRequest): Promise<void> {
  if (!checkInternalSecret(request.headers, INTERNAL_SECRET)) {
    throw new UnauthorizedError('Unauthorized');
  }
}
