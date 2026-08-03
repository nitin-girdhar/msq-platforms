// Shared logging configuration for backend services.
//
// Usage:
//
//   import { createLoggerOptions } from '@platform/logger';
//   const app = Fastify({
//     logger: createLoggerOptions({
//       service: 'meta-conversion-api',
//       nodeEnv: config.nodeEnv,
//       level: config.logLevel,
//     }),
//   });
//
// Conventions this package assumes at call sites:
//
//   - Log structured objects, not interpolated strings:
//       request.log.info({ evt: 'capi.trigger', outcome, reason_code }, 'CAPI trigger')
//     `evt` is a stable dotted event name and is what you filter on. Free text
//     belongs in the message argument, where it is never queried.
//   - Log IDs, never PII. A marketingLeadId identifies a lead precisely; the
//     lead's phone number identifies a person and is redacted anyway.
//   - Pass errors as `{ err }` so the serializer can strip credentials from
//     them. Do not pre-stringify an error or its upstream response body.

export { REDACT_CENSOR, REDACT_PATHS, sanitizeUrl } from './redact.js';
export { hashForLog, scrubText } from './scrub.js';
export { errorSerializer, requestSerializer, responseSerializer } from './serializers.js';
export { createLogger, createLoggerOptions } from './create-logger.js';
export type { LoggerOptionsInput } from './create-logger.js';
