import type { FastifyRequest } from 'fastify';
import { readAuthContext, checkInternalSecret } from '@crm/service-auth';
import { UnauthorizedError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

// Full session context — used by all lookup-admin routes.
export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  request.auth = result.auth;
}

// Gateway-secret-only check.
export async function requireInternalSecret(request: FastifyRequest): Promise<void> {
  if (!checkInternalSecret(request.headers, INTERNAL_SECRET)) {
    throw new UnauthorizedError('Unauthorized');
  }
}
