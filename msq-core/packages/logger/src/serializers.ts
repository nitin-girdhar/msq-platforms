// Serializers for the two objects that leak most often: errors and requests.

import { stdSerializers } from 'pino';
import { sanitizeUrl } from './redact.js';
import { scrubText } from './scrub.js';

/** Upstream response bodies are logged truncated — they are unbounded input. */
const MAX_RESPONSE_BODY_CHARS = 500;

interface SerializedError {
  type?: string;
  message?: string;
  stack?: string;
  [key: string]: unknown;
}

function truncate(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
  if (text === undefined) return '[unserializable]';
  const scrubbed = scrubText(text);
  return scrubbed.length > MAX_RESPONSE_BODY_CHARS
    ? `${scrubbed.slice(0, MAX_RESPONSE_BODY_CHARS)}…[truncated]`
    : scrubbed;
}

/**
 * Error serializer that strips the parts of an error object which carry
 * credentials, and text-scrubs what remains.
 *
 * The specific hazard this exists for: axios sends Meta's page access token as
 * a query param, and an AxiosError carries the whole request `config` — token
 * included — as an own enumerable property. Pino's default error serializer
 * copies own enumerable properties, so a plain `log.error({ err })` published a
 * live access token to stdout. Rather than asking every call site to remember
 * this, `config`/`request` are dropped here and the response is reduced to the
 * status plus a truncated, scrubbed body.
 *
 * Everything is rebuilt into a new object: mutating the serializer's input
 * would corrupt the caller's error, which may still be inspected or rethrown.
 */
export function errorSerializer(err: Error): SerializedError {
  const base = stdSerializers.err(err) as unknown as SerializedError;

  const out: SerializedError = {};
  for (const [key, value] of Object.entries(base)) {
    // Request internals: full headers, auth params, agents, retry state.
    // Nothing here is worth the exposure.
    if (key === 'config' || key === 'request') continue;

    if (key === 'response' && value && typeof value === 'object') {
      const response = value as Record<string, unknown>;
      out['response'] = {
        status: response['status'],
        statusText: response['statusText'],
        data: truncate(response['data']),
      };
      continue;
    }

    out[key] = value;
  }

  if (typeof base.message === 'string') out['message'] = scrubText(base.message);
  if (typeof base.stack === 'string') out['stack'] = scrubText(base.stack);

  // AppError-style errors carry a `details` payload that is echoed to clients;
  // it can contain submitted values, so it gets the same truncation treatment.
  if (out['details'] !== undefined) out['details'] = truncate(out['details']);

  return out;
}

interface LoggableRequest {
  method?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string | undefined } | undefined;
}

/**
 * Request serializer that logs the method, a sanitized URL and the caller
 * address — and deliberately no headers.
 *
 * Headers are where `x-internal-secret`, `authorization` and `cookie` live.
 * Dropping the whole bag is safer than maintaining an allowlist, and in
 * practice the header values were never what anyone needed from a log line.
 */
export function requestSerializer(request: LoggableRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: request.url ? sanitizeUrl(request.url) : undefined,
    remoteAddress: request.ip ?? request.socket?.remoteAddress,
  };
}

/** Response serializer — status code only. */
export function responseSerializer(reply: { statusCode?: number }): Record<string, unknown> {
  return { statusCode: reply.statusCode };
}
