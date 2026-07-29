import { requireStrongSecret } from '@platform/auth-constants';
import { createHash, timingSafeEqual } from 'node:crypto';

// Shared inter-service authentication logic for backend services.
//
// Every downstream service (identity, leads, communication, meta) trusts the
// API gateway to have verified the JWT and to inject the acting user's identity
// as headers alongside a shared internal secret. This module centralises that
// trust-boundary check so the header names, secret comparison, and rank parsing
// live in exactly one place instead of being copy-pasted per service.

// P1.3 — the BASE identity the gateway injects, read from headers only. The
// shrunk JWT no longer carries a product role/rank, so this no longer includes
// them: each service layers on the acting user's rank/role by resolving it from
// the DB (product services → <product>.member_roles; identity → the global
// iam ladder; admin/meta → the coarse platform rank). `platform_role` drives
// PG-role selection in withRoleTx and platform-level gates.
export interface AuthContext {
  org_id: string;
  user_id: string;
  tenant_id: string;
  platform_role: string;
}

type HeaderValue = string | string[] | undefined;
export type IncomingHeaders = Record<string, HeaderValue>;

function header(headers: IncomingHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Constant-time comparison for secrets presented by a caller (the internal
 * service secret, the webhook API key).
 *
 * `===` short-circuits at the first differing byte, so how long the comparison
 * takes leaks how many leading bytes the attacker guessed correctly -- enough,
 * over many samples, to recover the secret byte by byte.
 *
 * timingSafeEqual throws on length mismatch, and comparing lengths up front
 * would itself be an early-exit leak. Hashing both sides to a fixed 32 bytes
 * first makes the inputs constant-length, so neither the comparison nor any
 * length difference is observable in the timing.
 *
 * NOTE: this lives here, not in @platform/auth-constants, because that package
 * is imported by the product apps' Next.js Edge middleware, where `node:crypto`
 * is unavailable. service-auth is server-only, so Node built-ins are safe here.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Returns true only when the caller presented the exact shared internal secret.
 * A missing/empty configured secret always fails closed.
 */
export function checkInternalSecret(
  headers: IncomingHeaders,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  const provided = header(headers, 'x-internal-secret');
  if (!provided) return false;
  return safeEqual(provided, expectedSecret);
}

export type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; status: 401; error: 'Unauthorized' | 'Missing auth headers' };

/**
 * Validates the internal secret and extracts the acting user's context from the
 * gateway-injected headers. Never trusts the request body for identity.
 */
export function readAuthContext(
  headers: IncomingHeaders,
  expectedSecret: string | undefined,
): AuthResult {
  if (!checkInternalSecret(headers, expectedSecret)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const org_id = header(headers, 'x-org-id');
  const user_id = header(headers, 'x-user-id');
  const platform_role = header(headers, 'x-platform-role');

  if (!org_id || !user_id || !platform_role) {
    return { ok: false, status: 401, error: 'Missing auth headers' };
  }

  return {
    ok: true,
    auth: {
      org_id,
      user_id,
      platform_role,
      tenant_id: header(headers, 'x-tenant-id') || '',
    },
  };
}

/**
 * Boot-time gate for INTERNAL_SERVICE_SECRET — the shared value this module's
 * {@link checkInternalSecret} compares against, i.e. the whole basis on which a
 * downstream service trusts that a request came THROUGH the gateway rather than
 * around it.
 *
 * Previously only api-gateway and identity-service validated it. Every other
 * service (admin, communication, leads, notifications, meta, hr, tasks) read
 * `process.env['INTERNAL_SERVICE_SECRET']` directly at module scope across ~20
 * call sites and checked nothing, so:
 *
 *   - a placeholder or too-short secret was accepted platform-wide, even though
 *     the gateway itself would refuse to boot on one; and
 *   - a MISSING secret silently degraded checkInternalSecret to "always deny",
 *     turning every proxied request into a 401 that reads like an auth bug
 *     rather than the config error it is.
 *
 * Call once from each service's startup, BEFORE it accepts traffic. Fails hard
 * by design — a service that cannot authenticate the gateway is not usefully
 * "up", and a crash-looping container is visible in a way a log line is not.
 * Same shape and reasoning as `assertDbEnv` in @platform/db.
 *
 * Lives here rather than in @platform/auth-constants because that package is
 * imported by the product apps' Next.js Edge middleware and therefore carries no
 * `@types/node` — it cannot reference `process`. service-auth is server-only.
 */
export function assertInternalServiceSecret(opts: {
  nodeEnv: string;
  logPrefix?: string;
}): void {
  const prefix = opts.logPrefix ?? '';
  const value = process.env['INTERNAL_SERVICE_SECRET'];

  // Absence is checked in EVERY environment, not just production: without it the
  // service rejects all gateway traffic, which is a broken deployment anywhere.
  if (!value) {
    throw new Error(
      `${prefix}INTERNAL_SERVICE_SECRET is required — without it every request ` +
        `proxied from the api-gateway is rejected as unauthorized.`,
    );
  }

  // Placeholder/length enforcement stays production-only so local dev keeps
  // working with the .env.example defaults.
  requireStrongSecret('INTERNAL_SERVICE_SECRET', value, {
    nodeEnv: opts.nodeEnv,
    logPrefix: prefix,
  });
}
