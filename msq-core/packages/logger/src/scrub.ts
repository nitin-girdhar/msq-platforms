// Free-text scrubbing.
//
// Pino's `redact` option only walks object paths — it cannot see PII that has
// already been concatenated into a string. That is exactly how lead data was
// reaching the logs: an upstream 422 body was JSON-stringified into an
// `Error.message`, which then got logged as a message rather than as a field.
// So error messages and stacks get a second, text-level pass.

import { createHash } from 'node:crypto';
import { REDACT_CENSOR } from './redact.js';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Phone-like runs: 7+ digits, optionally grouped with spaces or parentheses.
 *
 * Hyphens and dots are deliberately excluded from the run, and the boundary
 * assertions reject a match adjacent to a word character, `-` or `.`. That
 * keeps UUIDs (`4bf92f35-77b3-…`), ISO dates (`2026-08-03`), IP addresses and
 * semver strings intact — those are the identifiers you actually need in order
 * to debug, and scrubbing them would make the logs useless.
 */
const PHONE_LIKE_RE = /(?<![\w.-])\+?\d[\d\s()]{5,}\d(?![\w.-])/g;

/**
 * Replaces email addresses and phone-like digit runs in arbitrary text.
 *
 * Intentionally conservative in what it treats as a phone number: a false
 * negative here is caught by the key-based redaction in `REDACT_PATHS`, whereas
 * a false positive silently destroys an ID someone needs.
 */
export function scrubText(text: string): string {
  return text.replace(EMAIL_RE, REDACT_CENSOR).replace(PHONE_LIKE_RE, REDACT_CENSOR);
}

/**
 * SHA-256 of a value, truncated to 12 hex chars, for the rare case where a
 * value must be correlated across log lines without being readable.
 *
 * Normalisation matches meta-conversion-api's CAPI payload builder (lowercase +
 * trim) so a hash logged here lines up with the hashes sent to Meta.
 *
 * NOT a privacy guarantee on its own: the input space for a phone number is
 * small enough to brute-force. Use it to answer "is this the same value as
 * that one", never as a way to smuggle PII into logs.
 */
export function hashForLog(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 12);
}
