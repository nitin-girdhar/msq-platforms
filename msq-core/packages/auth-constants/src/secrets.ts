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
