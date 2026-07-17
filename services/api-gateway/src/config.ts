function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const nodeEnv = process.env['NODE_ENV'] ?? 'development';

// Known insecure placeholder values shipped in .env.example. Refuse to boot with
// them (or with a too-short secret) in production so a misconfigured deploy fails
// loudly instead of running with a guessable JWT/internal secret.
const WEAK_SECRETS = new Set([
  'change-me-to-a-long-random-string-at-least-64-chars',
  'change-me-to-another-long-random-string',
  'change-me-webhook-key',
]);

function requireStrongSecret(name: string, minLength = 32): string {
  const value = requireEnv(name);
  if (nodeEnv === 'production' && (WEAK_SECRETS.has(value) || value.length < minLength)) {
    throw new Error(`${name} must be changed from its default and be at least ${minLength} characters in production`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env['GATEWAY_PORT'] ?? '4000', 10),
  nodeEnv,
  jwtSecret: requireStrongSecret('JWT_SECRET'),
  // Shared secret injected into every upstream request so services can
  // reject calls that bypass the gateway
  serviceSecret: requireStrongSecret('INTERNAL_SERVICE_SECRET'),
  // API key required by external callers of the intake webhook endpoint
  webhookApiKey: requireStrongSecret('WEBHOOK_API_KEY', 16),
  identityServiceUrl: process.env['IDENTITY_SERVICE_URL'] ?? 'http://localhost:4001',
  leadsServiceUrl: process.env['LEADS_SERVICE_URL'] ?? 'http://localhost:4002',
  metaServiceUrl: process.env['META_SERVICE_URL'] ?? 'http://localhost:4003',
  communicationServiceUrl: process.env['COMMUNICATION_SERVICE_URL'] ?? 'http://localhost:4005',
  notificationsServiceUrl: process.env['NOTIFICATIONS_SERVICE_URL'] ?? 'http://localhost:4004',
  adminServiceUrl: process.env['ADMIN_SERVICE_URL'] ?? 'http://localhost:4006',
  hrServiceUrl: process.env['HR_SERVICE_URL'] ?? 'http://localhost:4007',
  tasksServiceUrl: process.env['TASKS_SERVICE_URL'] ?? 'http://localhost:4008',
  webUrl: process.env['WEB_URL'] ?? 'http://localhost:3000',
  // Server-side pepper for verifying public API keys. Must match identity-service.
  // Required in production; without it the /public/v1 API returns 503.
  publicApiKeyPepper: process.env['PUBLIC_API_KEY_PEPPER'],
  // RS256 public key + kid for verifying asymmetric tokens and serving JWKS.
  // When unset, verification falls back to the legacy HS256 shared secret.
  jwtPublicKey: process.env['JWT_PUBLIC_KEY'],
  jwtKid: process.env['JWT_KID'],
} as const;

if (config.nodeEnv === 'production' && !config.publicApiKeyPepper) {
  throw new Error('PUBLIC_API_KEY_PEPPER is required in production');
}
