import { requireStrongSecret } from '@platform/auth-constants';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[identity-service] Missing required env var: ${name}`);
  return value;
}

const nodeEnv = process.env['NODE_ENV'] ?? 'development';

// Refuse to boot in production on a placeholder or too-short secret. This
// service SIGNS the tokens the whole platform trusts, so a weak JWT_SECRET
// here is forgeable sessions everywhere -- it warrants the same gate the
// gateway already applies at the edge.
function strongSecret(name: string, minLength = 32): string {
  return requireStrongSecret(name, requireEnv(name), {
    nodeEnv,
    minLength,
    logPrefix: '[identity-service] ',
  });
}

export const config = {
  port: parseInt(process.env['IDENTITY_SERVICE_PORT'] ?? '4001', 10),
  nodeEnv,
  jwtSecret: strongSecret('JWT_SECRET'),
  bcryptRounds: parseInt(process.env['BCRYPT_ROUNDS'] ?? '12', 10),
  passwordMinLength: parseInt(process.env['PASSWORD_MIN_LENGTH'] ?? '12', 10),
  // Account-level brute-force lockout. Complements (does not replace) the
  // gateway's per-IP login limiter: that one is evaded by IP rotation, this
  // one is not. Set LOGIN_MAX_FAILED_ATTEMPTS=0 to disable entirely.
  loginMaxFailedAttempts: parseInt(process.env['LOGIN_MAX_FAILED_ATTEMPTS'] ?? '10', 10),
  loginLockoutMinutes: parseInt(process.env['LOGIN_LOCKOUT_MINUTES'] ?? '15', 10),
  // How long a failed attempt stays "recent". Once the previous failure is
  // older than this, the counter restarts at 1 instead of accumulating. Keeping
  // it equal to the lockout duration also means an expired lock hands back a
  // full budget, rather than re-locking on the user's very next typo.
  loginAttemptWindowMinutes: parseInt(
    process.env['LOGIN_ATTEMPT_WINDOW_MINUTES'] ?? process.env['LOGIN_LOCKOUT_MINUTES'] ?? '15',
    10,
  ),
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseUrlService: requireEnv('DATABASE_URL_SERVICE'),
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
  secureCookies: process.env['COOKIE_SECURE'] === 'true',
  // Parent domain the session cookie is scoped to, e.g. `.app.com`, so every
  // product UI on a subdomain (lms./hr./todo./auth.) shares one SSO session.
  // Unset in local single-host dev → host-only cookie (the pre-split behavior).
  cookieDomain: process.env['COOKIE_DOMAIN'] || undefined,
  // Server-side pepper for HMAC-hashing public API keys. Must match the gateway's
  // value. Required in production; without it, API-client issuance is disabled.
  publicApiKeyPepper: process.env['PUBLIC_API_KEY_PEPPER'],
  // Asymmetric JWT signing (RS256). When a private key + kid are configured,
  // tokens are signed RS256 so other apps can verify them via the JWKS endpoint;
  // otherwise signing falls back to the legacy HS256 shared secret.
  jwtPrivateKey: process.env['JWT_PRIVATE_KEY'],
  jwtPublicKey: process.env['JWT_PUBLIC_KEY'],
  jwtKid: process.env['JWT_KID'],
  // leads-service owns lms.marketing_leads (N-5) — identity invokes it for the
  // branch-move/deactivation lead-reassignment saga rather than writing lms.*.
  leadsServiceUrl: process.env['LEADS_SERVICE_URL'] ?? 'http://localhost:4002',
} as const;

if (config.nodeEnv === 'production') {
  if (!config.publicApiKeyPepper) {
    throw new Error('[identity-service] PUBLIC_API_KEY_PEPPER is required in production');
  }
  // The pepper is what stops a stolen api_clients table from being replayed, so
  // it gets the same placeholder/length gate as the signing secrets.
  requireStrongSecret('PUBLIC_API_KEY_PEPPER', config.publicApiKeyPepper, {
    nodeEnv: config.nodeEnv,
    logPrefix: '[identity-service] ',
  });
}
