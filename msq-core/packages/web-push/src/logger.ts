// Logging seam for the package.
//
// The consuming service injects its own pino instance at startup — the same
// precedent as `setFollowUpCheckerLogger` in notifications-service. Until then
// (and in tests) this is a no-op rather than a module-scope `createLogger(...)`
// call: building a logger at import time drags in the pino-pretty transport in
// any non-production NODE_ENV, and a production image built with
// `pnpm deploy --prod` has no pino-pretty to load.

export type WebPushLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

const noopLogger: WebPushLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

let current: WebPushLogger = noopLogger;

/** Wire in the service's pino logger at startup. */
export function setWebPushLogger(logger: WebPushLogger): void {
  current = logger;
}

export function log(): WebPushLogger {
  return current;
}
