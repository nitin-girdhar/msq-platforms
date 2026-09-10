export const DEFAULT_AUTH_COOKIE_NAME = 'fc_session' as const;

/**
 * The session cookie's name, overridable per DEPLOYMENT via the `AUTH_COOKIE_NAME`
 * env var. Pass `process.env['AUTH_COOKIE_NAME']` (a service resolves it once in
 * its `config`; Edge/Next code passes it inline — a plain, non-`NEXT_PUBLIC_`
 * read is a real runtime lookup, see auth/sso.ts). Falls back to `fc_session`,
 * so an unset var keeps a single-environment deployment byte-for-byte unchanged.
 *
 * WHY IT MUST VARY PER ENVIRONMENT: a browser cookie is keyed by (name, domain).
 * Two environments under a shared parent domain — `apps.fitclass.in` and
 * `apps-uat.fitclass.in` both sit under `fitclass.in` — can each have their
 * session cookie delivered to the other's host. The receiving api-gateway then
 * verifies a foreign-signed token against its own `JWT_SECRET`, rejects it as
 * "Invalid token", and every client-side API call 401s while SSR (which forwards
 * the request's own cookie) still succeeds — a confusing half-broken app.
 * A distinct name per environment (`fc_session` / `fc_session_uat` /
 * `fc_session_dev`) makes the cookies invisible to each other regardless of
 * domain scope. Host-only cookies (`COOKIE_DOMAIN` unset) are the other half.
 *
 * Kept as a pure function (env value in, not read here) so this package stays
 * dependency-free — same reasoning as `hs256Accepted(rawEnvValue)`.
 */
export function authCookieName(rawEnvValue?: string | null): string {
  const trimmed = rawEnvValue?.trim();
  return trimmed ? trimmed : DEFAULT_AUTH_COOKIE_NAME;
}
export const JWT_EXPIRES_IN = '7d' as const;
export const JWT_MAX_AGE_SECONDS = 604800 as const;
export const JWT_ISSUER = 'fitclass-crm' as const;
export const JWT_AUDIENCE = 'fitclass-crm:web' as const;
export const JWT_ALGORITHM = 'HS256' as const;
