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
 * Returns true only when the caller presented the exact shared internal secret.
 * A missing/empty configured secret always fails closed.
 */
export function checkInternalSecret(
  headers: IncomingHeaders,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  const provided = header(headers, 'x-internal-secret');
  return provided === expectedSecret;
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
