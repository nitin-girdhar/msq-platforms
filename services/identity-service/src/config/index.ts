function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[identity-service] Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: parseInt(process.env['IDENTITY_SERVICE_PORT'] ?? '4001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  jwtSecret: requireEnv('JWT_SECRET'),
  bcryptRounds: parseInt(process.env['BCRYPT_ROUNDS'] ?? '12', 10),
  passwordMinLength: parseInt(process.env['PASSWORD_MIN_LENGTH'] ?? '12', 10),
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseUrlService: requireEnv('DATABASE_URL_SERVICE'),
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
  secureCookies: process.env['COOKIE_SECURE'] === 'true',
  // Server-side pepper for HMAC-hashing public API keys. Must match the gateway's
  // value. Required in production; without it, API-client issuance is disabled.
  publicApiKeyPepper: process.env['PUBLIC_API_KEY_PEPPER'],
  // Asymmetric JWT signing (RS256). When a private key + kid are configured,
  // tokens are signed RS256 so other apps can verify them via the JWKS endpoint;
  // otherwise signing falls back to the legacy HS256 shared secret.
  jwtPrivateKey: process.env['JWT_PRIVATE_KEY'],
  jwtPublicKey: process.env['JWT_PUBLIC_KEY'],
  jwtKid: process.env['JWT_KID'],
} as const;

if (config.nodeEnv === 'production' && !config.publicApiKeyPepper) {
  throw new Error('[identity-service] PUBLIC_API_KEY_PEPPER is required in production');
}
