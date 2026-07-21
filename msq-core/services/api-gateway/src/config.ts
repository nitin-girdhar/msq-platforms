import { requireStrongSecret as sharedRequireStrongSecret } from '@platform/auth-constants';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const nodeEnv = process.env['NODE_ENV'] ?? 'development';

// Placeholder/length gate now lives in @platform/auth-constants so the gateway
// and identity-service enforce the same rules against the same blocklist.
function requireStrongSecret(name: string, minLength = 32): string {
  return sharedRequireStrongSecret(name, requireEnv(name), {
    nodeEnv,
    minLength,
    logPrefix: '[api-gateway] ',
  });
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
  // Trusted proxy hops, used by Fastify to pick the real client IP out of
  // X-Forwarded-For — which the per-IP rate limiters key on.
  //
  // Count TRUSTED HOPS, not physical proxies. In this topology a browser
  // request reaches the gateway as:
  //     browser -> Caddy -> Next.js app (rewrite) -> gateway
  // which looks like two proxies, but the correct value is 1. Caddy APPENDS
  // the client IP to X-Forwarded-For, while Next.js only fills it in when
  // absent (`req.headers['x-forwarded-for'] ??= socket.remoteAddress` —
  // next/dist/server/base-server.js) and forwards it unchanged through the
  // `/api/:path*` rewrite. So the gateway sees a SINGLE XFF entry (the browser)
  // with the Next container as the socket peer => one trusted hop.
  //
  // Too low: every client collapses into one bucket (limiter stops working and
  // real users get 429s). Too high: a client can prepend its own
  // X-Forwarded-For and evade the limiter. 0 = gateway exposed directly.
  trustProxyHops: parseInt(process.env['TRUST_PROXY_HOPS'] ?? '0', 10),
  // Server-side pepper for verifying public API keys. Must match identity-service.
  // Required in production; without it the /public/v1 API returns 503.
  publicApiKeyPepper: process.env['PUBLIC_API_KEY_PEPPER'],
  // RS256 public key + kid for verifying asymmetric tokens and serving JWKS.
  // When unset, verification falls back to the legacy HS256 shared secret.
  jwtPublicKey: process.env['JWT_PUBLIC_KEY'],
  jwtKid: process.env['JWT_KID'],
} as const;

if (config.nodeEnv === 'production') {
  if (!config.publicApiKeyPepper) {
    throw new Error('[api-gateway] PUBLIC_API_KEY_PEPPER is required in production');
  }
  // Must match identity-service's value AND its strength gate, or a rotation
  // that satisfies one service but not the other fails asymmetrically.
  sharedRequireStrongSecret('PUBLIC_API_KEY_PEPPER', config.publicApiKeyPepper, {
    nodeEnv: config.nodeEnv,
    logPrefix: '[api-gateway] ',
  });
}
