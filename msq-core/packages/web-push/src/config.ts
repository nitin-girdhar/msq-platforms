// VAPID configuration for Web Push.
//
// Read here and nowhere else in this package. Services keep their own
// `config/index.ts` rule; a shared platform package owns its own env the same
// way `@platform/db` owns DATABASE_URL* (see assertDbEnv).

import webpush from 'web-push';

const VAPID_ENV_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

let configured = false;

/**
 * Fail fast at boot if VAPID is not configured, rather than lazily on the first
 * send — which in practice means "the first time a follow-up came due", i.e.
 * silently, inside a poller tick nobody is watching. Mirrors `assertDbEnv()`.
 *
 * Call from each consuming service's `start()`, before it accepts traffic.
 */
export function assertWebPushEnv(): void {
  const missing = VAPID_ENV_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required Web Push env var(s): ${missing.join(', ')}. ` +
      `Generate a key pair once with \`npx web-push generate-vapid-keys\` and set them ` +
      `in the service .env (see .env.example). Note that ROTATING these keys invalidates ` +
      `every existing push subscription on every device — see packages/web-push/README.md.`,
    );
  }

  const subject = process.env['VAPID_SUBJECT'] as string;
  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) {
    throw new Error(
      `VAPID_SUBJECT must be a 'mailto:' or 'https://' URL (got '${subject}'). ` +
      `Push services reject a subscription request with anything else.`,
    );
  }
}

/**
 * Whether this environment may SEND web pushes. On unless WEB_PUSH_ENABLED is exactly 'false', so
 * a missing variable keeps UAT and production sending. Local development sets it to 'false': the
 * local database is a copy of production data, with real people's push subscriptions in it.
 * Subscriptions are still recorded when off, so switching it on later needs no re-subscribe.
 */
export function isWebPushEnabled(): boolean {
  return (process.env['WEB_PUSH_ENABLED'] ?? 'true').trim().toLowerCase() !== 'false';
}

/**
 * Applies the VAPID details to the `web-push` library exactly once per process.
 * Idempotent so callers never have to reason about ordering.
 */
export function ensureVapidConfigured(): void {
  if (configured) return;
  assertWebPushEnv();
  webpush.setVapidDetails(
    process.env['VAPID_SUBJECT'] as string,
    process.env['VAPID_PUBLIC_KEY'] as string,
    process.env['VAPID_PRIVATE_KEY'] as string,
  );
  configured = true;
}

/** The VAPID public key, for the client to build a `PushSubscription` with. */
export function vapidPublicKey(): string {
  assertWebPushEnv();
  return process.env['VAPID_PUBLIC_KEY'] as string;
}

/** Test seam: forget that setVapidDetails already ran. */
export function resetVapidConfiguredForTests(): void {
  configured = false;
}
