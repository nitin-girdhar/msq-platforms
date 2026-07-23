import postgres from 'postgres';
import { makePool } from './pool-factory.js';

let _app: ReturnType<typeof postgres> | null = null;
let _tenant: ReturnType<typeof postgres> | null = null;
let _service: ReturnType<typeof postgres> | null = null;

export function appDb(): ReturnType<typeof postgres> {
  if (!_app) {
    if (!process.env['DATABASE_URL']) throw new Error('DATABASE_URL is required');
    _app = makePool(process.env['DATABASE_URL']);
  }
  return _app;
}

export function tenantDb(): ReturnType<typeof postgres> {
  if (!_tenant) {
    if (!process.env['DATABASE_URL_TENANT']) throw new Error('DATABASE_URL_TENANT is required');
    _tenant = makePool(process.env['DATABASE_URL_TENANT']);
  }
  return _tenant;
}

export function serviceDb(): ReturnType<typeof postgres> {
  if (!_service) {
    if (!process.env['DATABASE_URL_SERVICE']) throw new Error('DATABASE_URL_SERVICE is required');
    _service = makePool(process.env['DATABASE_URL_SERVICE']);
  }
  return _service;
}

/**
 * Fail fast at boot if a required DB connection string is absent, instead of
 * throwing lazily on the first request that happens to need that pool. Issue #1
 * was a missing DATABASE_URL_TENANT that stayed invisible until a tenant_admin
 * (the highest-value customer role) hit the service in production and got a 500.
 * Call this from each service's startup, before it begins accepting traffic.
 */
export function assertDbEnv(
  required: readonly string[] = ['DATABASE_URL', 'DATABASE_URL_SERVICE', 'DATABASE_URL_TENANT'],
): void {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required database env var(s): ${missing.join(', ')}. ` +
      `Set them in the service .env (see .env.example) or run \`make setup-env\`.`,
    );
  }
}

export async function closeAllPools(): Promise<void> {
  await Promise.all([
    _app?.end(),
    _tenant?.end(),
    _service?.end(),
  ]);
  _app = null;
  _tenant = null;
  _service = null;
}
