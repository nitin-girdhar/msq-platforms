// Shared boot-time validation for security-critical secrets.
//
// Previously this lived only in api-gateway/src/config.ts, which left
// identity-service -- the service that actually SIGNS tokens -- able to boot in
// production with the placeholder JWT_SECRET from .env.example. A weak secret
// there is forgeable sessions platform-wide, so the check belongs everywhere a
// secret is consumed, not just at the edge.

/**
 * Known insecure placeholder values shipped in .env.example. Booting with any
 * of these in production means a rotation step was missed.
 */
export const WEAK_SECRETS: ReadonlySet<string> = new Set([
  'change-me-to-a-long-random-string-at-least-64-chars',
  'change-me-to-another-long-random-string',
  'change-me-webhook-key',
  'change-me-public-api-pepper',
]);

export interface RequireStrongSecretOptions {
  /** Minimum acceptable length. Defaults to 32. */
  minLength?: number;
  /** Environment name; enforcement only applies when this is 'production'. */
  nodeEnv: string;
  /** Prefix for error messages, e.g. '[identity-service] '. */
  logPrefix?: string;
}

/**
 * Returns `value` unchanged, throwing in production when it is a known
 * placeholder or shorter than `minLength`.
 *
 * Deliberately fails hard rather than warning: a service running with a
 * guessable signing key is worse than a service that refuses to start, and a
 * crash-looping container is visible in a way a log line is not.
 *
 * Outside production this is a no-op so local dev keeps working with the
 * .env.example defaults.
 */
export function requireStrongSecret(
  name: string,
  value: string,
  opts: RequireStrongSecretOptions,
): string {
  const minLength = opts.minLength ?? 32;
  const prefix = opts.logPrefix ?? '';

  if (opts.nodeEnv === 'production') {
    if (WEAK_SECRETS.has(value)) {
      throw new Error(
        `${prefix}${name} is still set to its .env.example placeholder. ` +
          `Generate a unique value (e.g. \`openssl rand -base64 48\`) before deploying to production.`,
      );
    }
    if (value.length < minLength) {
      throw new Error(
        `${prefix}${name} must be at least ${minLength} characters in production (got ${value.length}).`,
      );
    }
  }

  return value;
}

/**
 * Whether legacy HS256 session tokens may still be accepted.
 *
 * Both verifiers (identity-service, api-gateway) and the shared edge verifier
 * pick their key from the token's own `alg` header so HS256 and RS256 can
 * coexist during the RS256 rollout. That selection is safe in itself — an
 * HS256 token is verified with the HMAC secret, never with the RSA public key,
 * so it is not the classic algorithm-confusion bug.
 *
 * The problem is that there was no way to ever STOP accepting HS256. While it
 * is accepted, RS256 buys nothing security-wise: the RSA private key may live
 * only in identity-service, but `JWT_SECRET` mints equally valid tokens and has
 * to be present in every service that verifies. The forgery blast radius stays
 * "anyone who can read JWT_SECRET anywhere", which is exactly what moving to an
 * asymmetric key is supposed to shrink.
 *
 * Setting `JWT_ALLOW_HS256=false` is therefore the last step of the migration,
 * and the one that makes the earlier steps worth doing:
 *
 *   1. configure JWT_PRIVATE_KEY + JWT_KID on identity-service (signs RS256),
 *      and JWT_PUBLIC_KEY everywhere that verifies;
 *   2. wait out one token lifetime so no HS256 tokens remain in circulation;
 *   3. set JWT_ALLOW_HS256=false everywhere;
 *   4. delete JWT_SECRET from every service that does not sign.
 *
 * Defaults to allowing HS256 so an existing deployment is unaffected until the
 * operator opts in. ONLY the exact string 'false' disables it — a typo must not
 * silently keep a migration half-finished while looking complete.
 */
export function hs256Accepted(rawEnvValue: string | undefined): boolean {
  return rawEnvValue !== 'false';
}
