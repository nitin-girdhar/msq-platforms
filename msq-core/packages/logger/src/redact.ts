// Default-deny redaction for everything the platform logs.
//
// The rule this module enforces: a developer must not be able to leak a secret
// or a lead's PII by writing an ordinary log line. Before this existed, three
// live leaks were reachable without anyone doing anything unusual — a Meta page
// access token rode along inside an AxiosError's `config.params`, a webhook
// verify token was printed as part of the request URL, and a lead's name/phone/
// email arrived pre-stringified inside an upstream error message. Redaction is
// therefore centralised and applied to every service, not left to call sites.

/** What a redacted value is replaced with. */
export const REDACT_CENSOR = '[REDACTED]';

/**
 * Credential-bearing keys. Anything named like one of these is censored no
 * matter where it appears in a log object.
 */
const SECRET_KEYS = [
  'access_token',
  'accessToken',
  'app_secret',
  'appSecret',
  'verify_token',
  'verifyToken',
  'refresh_token',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'apiKey',
  'api_key',
  'internalServiceSecret',
  'INTERNAL_SERVICE_SECRET',
  'encryptionKey',
  'META_ENCRYPTION_KEY',
  'JWT_SECRET',
  'jwtSecret',
  'DATABASE_URL',
  'DATABASE_URL_SERVICE',
  'databaseUrl',
  'databaseUrlService',
] as const;

/**
 * Request/response headers that carry credentials.
 *
 * Note the serializers in `create-logger.ts` drop headers wholesale; these
 * paths are belt-and-braces for anywhere a raw header bag is logged directly.
 */
const HEADER_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-internal-secret',
  'x-hub-signature-256',
] as const;

/**
 * Personally identifiable fields on a lead or a user.
 *
 * Deliberately kept in sync with the contact/professional field names in
 * meta-conversion-api's DEFAULT_FIELD_MAPPINGS — those are the keys a Meta lead
 * form actually populates, and they flow through this platform under exactly
 * these names. `field_data` is Meta's raw answer array: every question the lead
 * answered, so it is redacted wholesale rather than field by field.
 */
const PII_KEYS = [
  'email',
  'phone',
  'phone_number',
  'mobile_number',
  'first_name',
  'last_name',
  'full_name',
  'whatsapp_number',
  'work_email',
  'work_phone_number',
  'date_of_birth',
  'street_address',
  'postal_code',
  'zip_code',
  'field_data',
  'raw_webhook_data',
  'recipient',
  'to',
] as const;

const SENSITIVE_KEYS = [...SECRET_KEYS, ...HEADER_KEYS, ...PII_KEYS];

/**
 * Pino matches redact paths literally, so a bare key name only censors a
 * top-level property. Each key is expanded to the nesting depths that actually
 * occur in practice: top level, one level down (`integration.access_token`,
 * `lead.email`), two levels down (`err.config.params.access_token`), and inside
 * the standard `req`/`res` serializer output.
 */
function expand(key: string): string[] {
  // Keys containing a dot or dash must be bracket-quoted for pino's parser.
  const leaf = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `["${key}"]`;
  const join = (prefix: string): string => (leaf.startsWith('[') ? `${prefix}${leaf}` : `${prefix}.${leaf}`);
  return [
    leaf.startsWith('[') ? `*${leaf}` : leaf,
    join('*'),
    join('*.*'),
    join('*.*.*'),
    join('req.headers'),
    join('res.headers'),
  ];
}

/**
 * The `redact.paths` list handed to pino.
 *
 * Deduplicated because several expansions overlap and pino throws on duplicate
 * paths rather than ignoring them.
 */
export const REDACT_PATHS: string[] = [...new Set(SENSITIVE_KEYS.flatMap(expand))];

/** Query-string parameters whose VALUE is a credential. */
const SENSITIVE_QUERY_PARAMS = new Set([
  'access_token',
  'hub.verify_token',
  'verify_token',
  'token',
  'api_key',
  'apiKey',
  'code',
]);

/**
 * Blanks credential-bearing query parameters while leaving the rest of the URL
 * intact.
 *
 * Meta's webhook subscription handshake arrives as
 * `GET /api/v1/webhook?hub.mode=subscribe&hub.verify_token=<secret>&hub.challenge=…`,
 * and Fastify's default request logging prints `req.url` verbatim — so the
 * verify token was being written to stdout at info level on every handshake.
 * The parameter NAME is kept so the shape of the request stays debuggable.
 */
export function sanitizeUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);

  const sanitized = query
    .split('&')
    .map((pair) => {
      if (pair === '') return pair;
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const rawKey = pair.slice(0, eq);
      // Compare on the decoded key: `hub%2Everify_token` must not slip through.
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        // Malformed percent-encoding — fall back to the raw key rather than throwing.
      }
      return SENSITIVE_QUERY_PARAMS.has(key) ? `${rawKey}=${REDACT_CENSOR}` : pair;
    })
    .join('&');

  return `${path}?${sanitized}`;
}
