import type { FastifyRequest } from 'fastify';
import { readAuthContext, checkInternalSecret } from '@crm/service-auth';
import { UnauthorizedError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  request.auth = result.auth;
}

// Gateway-secret-only check for the public send path — the API key, scope, and
// recipient allowlist are all enforced at the gateway; here we only confirm the
// call came through the gateway and read the tenant from the injected headers.
export async function requireInternalSecret(request: FastifyRequest): Promise<void> {
  if (!checkInternalSecret(request.headers, INTERNAL_SECRET)) {
    throw new UnauthorizedError('Unauthorized');
  }
}
