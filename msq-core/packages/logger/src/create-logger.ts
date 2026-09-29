// The single logger configuration every service uses.
//
// Before this, all nine services carried a byte-identical six-line pino block
// with no redaction, no serializers, and an epoch-millisecond timestamp. Fixing
// a leak meant fixing it nine times, and in practice it was fixed zero times.

import pino, { stdTimeFunctions, type Logger } from 'pino';
import { REDACT_CENSOR, REDACT_PATHS } from './redact.js';
import { errorSerializer, requestSerializer, responseSerializer } from './serializers.js';

export interface LoggerOptionsInput {
  /** Service name stamped on every line, e.g. 'meta-conversion-api'. */
  service: string;
  /** Usually `config.nodeEnv`. Controls pretty-printing only. */
  nodeEnv: string;
  /**
   * Explicit level override. When omitted, `LOG_LEVEL` is honoured, falling
   * back to `info` in production and `debug` elsewhere.
   */
  level?: string | undefined;
}

/**
 * Builds the `logger` option for `Fastify({ logger })`.
 *
 * Fixed platform-wide by this function:
 *
 * - **Timestamps** are ISO-8601 UTC with milliseconds
 *   (`"time":"2026-08-03T09:15:37.189Z"`) instead of raw epoch ms, which was
 *   unreadable when tailing container logs. Output stays JSON — pino always
 *   emits `level` as the first key and `time` second — so `jq`, grep and any
 *   future log shipper keep working.
 * - **Redaction** is on by default for credentials and lead PII.
 * - **Serializers** strip request headers and error internals.
 * - **`pid`/`hostname` are dropped** in favour of `service`: inside Docker the
 *   hostname is a random container hash and the pid is always 1, so both were
 *   noise on every single line, while the service name — the thing you actually
 *   filter by — was absent.
 */
export function createLoggerOptions(input: LoggerOptionsInput): Record<string, unknown> {
  const { service, nodeEnv } = input;
  const isProduction = nodeEnv === 'production';
  const level = input.level ?? process.env['LOG_LEVEL'] ?? (isProduction ? 'info' : 'debug');

  return {
    level,
    base: { service },
    timestamp: stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    serializers: {
      err: errorSerializer,
      req: requestSerializer,
      res: responseSerializer,
    },
    // `pino-pretty` is a RUNTIME dependency, not a devDependency, and must stay
    // one. Production images are built with `pnpm deploy --prod`, which drops
    // devDependencies — but the image's `NODE_ENV=production` is overridden back
    // to `development` by compose's `env_file: .env`, so this branch is taken
    // inside the container and pino resolves the target at startup. As a
    // devDependency that resolution failed with `unable to determine transport
    // target for "pino-pretty"`, crash-looping api-gateway, identity-service,
    // admin-service and communication-service on every `docker compose up`.
    //
    // Do NOT "fix" that by forcing NODE_ENV=production in compose instead: it
    // trips the PUBLIC_API_KEY_PEPPER strong-secret gate in api-gateway's
    // config.ts and starts emitting HSTS on app.localhost, which Chrome treats
    // as a secure context — so the header sticks and poisons the host.
    ...(isProduction
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              // Match the production clock so a timestamp means the same thing
              // in both environments.
              translateTime: 'UTC:yyyy-mm-dd HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }),
  };
}

/**
 * A standalone pino instance with the same configuration Fastify gets.
 *
 * For code that runs outside a request: fire-and-forget helpers, the daily
 * report cron entrypoint, background pollers. These were the places still
 * reaching for `console.error`, which bypasses levels, redaction and JSON
 * structure entirely — the output was invisible to every log query.
 */
export function createLogger(input: LoggerOptionsInput): Logger {
  return pino(createLoggerOptions(input) as pino.LoggerOptions);
}
