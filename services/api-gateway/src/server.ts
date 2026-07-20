import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { AUTH_COOKIE_NAME } from '@crm/auth-constants';
import { configureProductSource } from '@platform/authz';
import { getActiveTenantModulesByTenantId } from '@crm/db';
import { config } from './config.js';
import { proxyTo, proxyToRaw, proxySSE } from './lib/proxy.js';
import { authPreHandler } from './middleware/auth.js';
import { productGuard } from './middleware/require-product.js';
import { communicationSendGuard } from './middleware/comms-send-guard.js';
import { verifyJwtEdge, revokeJti } from './lib/jwt-verify.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { publicApiKeyAuth, publicUserContext, publicScopeHeaders } from './lib/public-auth.js';
import { publicCommsGuard } from './lib/public-comms.js';
import { getJwks } from './lib/jwks.js';

const app = Fastify({
  // Attendance punch photos travel as base64 in the JSON body (≤2 MB binary ≈
  // ≤2.8 MB base64); raise the default 1 MB limit so those requests proxy through.
  bodyLimit: 5 * 1024 * 1024,
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    ...(config.nodeEnv !== 'production' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  },
});

// Capture raw body alongside parsed JSON so proxyToRaw can forward
// the original bytes for HMAC verification on Meta webhook routes.
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    try {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const parsed = JSON.parse(buf.toString('utf-8'));
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

app.register(cookie);
app.register(cors, {
  origin: config.webUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
});

// Baseline security response headers on every proxied response.
app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  if (config.nodeEnv === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return payload;
});

// Aggressive limit on credential endpoints; looser on public webhooks.
const loginRateLimit = createRateLimiter({ max: 10, windowMs: 60_000 });
const webhookRateLimit = createRateLimiter({ max: 60, windowMs: 60_000 });

app.get('/health', async () => ({ status: 'ok', service: 'api-gateway' }));

// JWKS — public keys other apps use to verify CRM-issued RS256 tokens.
app.get('/.well-known/jwks.json', async (_req, reply) => {
  reply.header('Cache-Control', 'public, max-age=3600');
  return getJwks();
});

// ── Public routes (no JWT required) ────────────────────────────────────────
app.post('/auth/login', { preHandler: [loginRateLimit] }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/auth/login', req, reply);
});

app.post('/auth/logout', async (req, reply) => {
  // Revoke the JTI in the DB before proxying so protected routes reject immediately
  const token = req.cookies[AUTH_COOKIE_NAME];
  if (token) {
    const result = await verifyJwtEdge(token);
    if (result.ok && result.payload.jti && result.payload.exp) {
      await revokeJti(result.payload.jti, result.payload.exp, {
        user_id: result.payload.sub,
        org_id: result.payload.org_id,
        tenant_id: result.payload.tenant_id,
      });
    }
  }
  return proxyTo(config.identityServiceUrl, '/api/v1/auth/logout', req, reply, undefined, { forwardCookies: true });
});

app.get('/auth/me', async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/auth/me', req, reply, undefined, { forwardCookies: true });
});

// Branch switching — identity-service verifies the session cookie itself and
// validates the target org against iam.user_org_mapping, so these forward the
// cookie like /auth/me rather than the gateway-derived user headers.
app.get('/auth/my-orgs', async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/auth/my-orgs', req, reply, undefined, { forwardCookies: true });
});

app.post('/auth/switch-org', { preHandler: [loginRateLimit] }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/auth/switch-org', req, reply, undefined, { forwardCookies: true });
});

// ── Intake webhook (no JWT — called by ad platforms) ───────────────────────
// Rate-limited to 60 requests/minute per IP. Requires a pre-shared API key
// in the X-Api-Key header so only registered ad platform integrations can post.
app.post('/intake/webhook', { preHandler: [webhookRateLimit] }, async (req, reply) => {
  const apiKey = (req.headers['x-api-key'] as string | undefined) ?? '';
  if (!apiKey || apiKey !== config.webhookApiKey) {
    return reply.status(401).send({ error: 'Invalid or missing API key' });
  }
  return proxyTo(config.leadsServiceUrl, '/api/v1/intake/webhook', req, reply);
});

// ── Meta webhook (public — called by Meta, no JWT) ──────────────────────────
// HMAC verification happens inside meta-conversion-api itself (per-tenant or
// shared-app secret). Tenant-less route (no :integrationId) is for a single
// Meta App shared across multiple tenants; resolved to the ext.meta_tenant_config
// row with tenant_id IS NULL downstream.
app.get('/meta/webhook', async (req, reply) => {
  return proxyTo(config.metaServiceUrl, '/api/v1/webhook', req, reply);
});
app.post('/meta/webhook', async (req, reply) => {
  return proxyToRaw(config.metaServiceUrl, '/api/v1/webhook', req, reply);
});
app.get('/meta/webhook/:integrationId', async (req, reply) => {
  const { integrationId } = req.params as { integrationId: string };
  return proxyTo(config.metaServiceUrl, `/api/v1/webhook/${integrationId}`, req, reply);
});
app.post('/meta/webhook/:integrationId', async (req, reply) => {
  const { integrationId } = req.params as { integrationId: string };
  return proxyToRaw(config.metaServiceUrl, `/api/v1/webhook/${integrationId}`, req, reply);
});

// ── Public / partner API (API-key auth, not JWT) ────────────────────────────
// Scoped, tenant/branch-bound keys. The prehandler resolves the client from the
// key and enforces scope + per-key rate limit; the tenant/org binding (not the
// body) drives isolation downstream.
app.post('/public/v1/leads', { preHandler: [publicApiKeyAuth('leads:write')] }, async (req, reply) => {
  const client = req.publicClient!;
  return proxyTo(config.leadsServiceUrl, '/api/v1/intake/public', req, reply, publicUserContext(client), { extraHeaders: publicScopeHeaders(client) });
});

// Read APIs (per tenant/branch). Field-minimized DTOs, tenant-scoped downstream.
app.get('/public/v1/branches', { preHandler: [publicApiKeyAuth('branches:read')] }, async (req, reply) => {
  const client = req.publicClient!;
  return proxyTo(config.identityServiceUrl, '/api/v1/public/branches', req, reply, publicUserContext(client), { extraHeaders: publicScopeHeaders(client) });
});
app.get('/public/v1/users', { preHandler: [publicApiKeyAuth('users:read')] }, async (req, reply) => {
  const client = req.publicClient!;
  return proxyTo(config.identityServiceUrl, '/api/v1/public/users', req, reply, publicUserContext(client), { extraHeaders: publicScopeHeaders(client) });
});

// Communications send. Guard enforces scope-based content gating + tenant
// recipient allowlisting before the message is dispatched.
app.post('/public/v1/communications/send', { preHandler: [publicApiKeyAuth('comms:send'), publicCommsGuard] }, async (req, reply) => {
  const client = req.publicClient!;
  return proxyTo(config.communicationServiceUrl, '/api/v1/communications/public-send', req, reply, publicUserContext(client), { extraHeaders: publicScopeHeaders(client) });
});

// ── Protected routes ────────────────────────────────────────────────────────
// Every protected route runs authPreHandler (JWT → req.userCtx) then productGuard
// (D6 entitlement choke point: 403 if the tenant hasn't licensed the route's
// product). Public routes above register no auth and are never product-gated.
configureProductSource(getActiveTenantModulesByTenantId);
const withAuth = { preHandler: [authPreHandler, productGuard] };
// Communication send routes: additionally enforce the read_only send-block here
// (communication-service itself is a stateless relay — see comms-send-guard).
const withCommsSend = { preHandler: [authPreHandler, productGuard, communicationSendGuard] };

// Notifications (SSE — long-lived connection)
app.get('/notifications/stream', { ...withAuth }, async (req, reply) => {
  return proxySSE(config.notificationsServiceUrl, '/api/v1/notifications/stream', req, reply, req.userCtx);
});

// Auth
app.post('/auth/change-password', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/auth/change-password', req, reply, req.userCtx);
});

// Leads
app.get('/leads', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/leads', req, reply, req.userCtx);
});
app.post('/leads', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/leads', req, reply, req.userCtx);
});
app.get('/leads/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}`, req, reply, req.userCtx);
});
app.patch('/leads/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}`, req, reply, req.userCtx);
});
app.delete('/leads/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}`, req, reply, req.userCtx);
});
app.post('/leads/:id/transfer', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/transfer`, req, reply, req.userCtx);
});
app.get('/leads/:id/timeline', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/timeline`, req, reply, req.userCtx);
});
app.get('/leads/:id/form-data', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/form-data`, req, reply, req.userCtx);
});
app.get('/leads/:id/interactions', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/interactions`, req, reply, req.userCtx);
});
app.post('/leads/:id/interactions', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/interactions`, req, reply, req.userCtx);
});
app.get('/leads/:id/assignment-history', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/assignment-history`, req, reply, req.userCtx);
});
app.get('/leads/:id/follow-ups', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/follow-ups`, req, reply, req.userCtx);
});
app.post('/leads/:id/follow-ups', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/follow-ups`, req, reply, req.userCtx);
});
app.patch('/leads/:id/follow-ups/:followUpId', { ...withAuth }, async (req, reply) => {
  const { id, followUpId } = req.params as { id: string; followUpId: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/follow-ups/${followUpId}`, req, reply, req.userCtx);
});
app.delete('/leads/:id/follow-ups/:followUpId', { ...withAuth }, async (req, reply) => {
  const { id, followUpId } = req.params as { id: string; followUpId: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/leads/${id}/follow-ups/${followUpId}`, req, reply, req.userCtx);
});

// Leads — assignments within lead context
app.get('/leads/:id/assignments', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/assignments/${id}`, req, reply, req.userCtx);
});

// Cross-lead follow-ups pipeline
app.get('/follow-ups', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/follow-ups', req, reply, req.userCtx);
});

// Campaigns
app.get('/campaigns', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/campaigns', req, reply, req.userCtx);
});
app.post('/campaigns', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/campaigns', req, reply, req.userCtx);
});
app.get('/campaigns/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/campaigns/${id}`, req, reply, req.userCtx);
});
app.patch('/campaigns/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/campaigns/${id}`, req, reply, req.userCtx);
});
app.delete('/campaigns/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/campaigns/${id}`, req, reply, req.userCtx);
});

// Lookups
app.get('/lookups', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/lookups', req, reply, req.userCtx);
});
app.get('/lookups/cities', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/lookups/cities', req, reply, req.userCtx);
});
app.get('/lookups/lead-stages', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/lookups/lead-stages', req, reply, req.userCtx);
});
app.get('/lookups/lead-stage-outcomes', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/lookups/lead-stage-outcomes', req, reply, req.userCtx);
});

// Lookup Admin (super_admin only — enforced in admin-service)
app.get('/lookups/org-types', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/org-types', req, reply, req.userCtx);
});
app.post('/lookups/org-types', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/org-types', req, reply, req.userCtx);
});
app.patch('/lookups/org-types/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.adminServiceUrl, `/api/v1/lookups/org-types/${id}`, req, reply, req.userCtx);
});

app.get('/lookups/tenant-domains', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/tenant-domains', req, reply, req.userCtx);
});
app.post('/lookups/tenant-domains', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/tenant-domains', req, reply, req.userCtx);
});
app.patch('/lookups/tenant-domains/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.adminServiceUrl, `/api/v1/lookups/tenant-domains/${id}`, req, reply, req.userCtx);
});

app.get('/lookups/tenant-plan-types', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/tenant-plan-types', req, reply, req.userCtx);
});
app.post('/lookups/tenant-plan-types', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/tenant-plan-types', req, reply, req.userCtx);
});
app.patch('/lookups/tenant-plan-types/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.adminServiceUrl, `/api/v1/lookups/tenant-plan-types/${id}`, req, reply, req.userCtx);
});

app.get('/lookups/user-roles', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/user-roles', req, reply, req.userCtx);
});
app.post('/lookups/user-roles', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/user-roles', req, reply, req.userCtx);
});
app.patch('/lookups/user-roles/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.adminServiceUrl, `/api/v1/lookups/user-roles/${id}`, req, reply, req.userCtx);
});

// The 7 LMS marketing lookups (lead-stage, lead-stage-outcome, interaction-types,
// follow-up-statuses, lead-sources, marketing-platforms, campaign-statuses) are
// now tenant-scoped and owned by leads-service (N-6 Half B) — registered via the
// TENANT_LOOKUP_TARGETS map below, not here.

app.get('/lookups/tenants', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/tenants', req, reply, req.userCtx);
});
app.post('/lookups/tenants', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/tenants', req, reply, req.userCtx);
});
app.patch('/lookups/tenants/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.adminServiceUrl, `/api/v1/lookups/tenants/${id}`, req, reply, req.userCtx);
});

app.get('/lookups/organizations', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/organizations', req, reply, req.userCtx);
});
app.post('/lookups/organizations', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.adminServiceUrl, '/api/v1/lookups/organizations', req, reply, req.userCtx);
});
app.patch('/lookups/organizations/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.adminServiceUrl, `/api/v1/lookups/organizations/${id}`, req, reply, req.userCtx);
});

// Tenant-scoped lookup/role admin (N-6 Half A): super_admin manages a SELECTED
// tenant's product reference data. These 8 slugs are owned by their product
// service (which writes its own schema under tenant RLS — never root_service via
// admin-service). Ungated at the entitlement layer (super_admin is platform
// staff, not a product licensee); the product service enforces the super_admin
// gate. The `?tenant_id=` query is forwarded verbatim by proxyTo.
const TENANT_LOOKUP_TARGETS: Record<string, string> = {
  'task-statuses':      config.tasksServiceUrl,
  'task-priorities':    config.tasksServiceUrl,
  'task-roles':         config.tasksServiceUrl,
  'leave-types':        config.hrServiceUrl,
  'employment-types':   config.hrServiceUrl,
  'attendance-statuses':config.hrServiceUrl,
  'hr-roles':           config.hrServiceUrl,
  'lms-roles':          config.leadsServiceUrl,
  // N-6 Half B — 7 tenant-scoped LMS marketing lookups
  'lead-stage':         config.leadsServiceUrl,
  'lead-stage-outcome': config.leadsServiceUrl,
  'interaction-types':  config.leadsServiceUrl,
  'follow-up-statuses': config.leadsServiceUrl,
  'lead-sources':       config.leadsServiceUrl,
  'marketing-platforms':config.leadsServiceUrl,
  'campaign-statuses':  config.leadsServiceUrl,
};
for (const [slug, target] of Object.entries(TENANT_LOOKUP_TARGETS)) {
  app.get(`/lookups/${slug}`, { ...withAuth }, async (req, reply) => {
    return proxyTo(target, `/api/v1/lookups/${slug}`, req, reply, req.userCtx);
  });
  app.post(`/lookups/${slug}`, { ...withAuth }, async (req, reply) => {
    return proxyTo(target, `/api/v1/lookups/${slug}`, req, reply, req.userCtx);
  });
  app.patch(`/lookups/${slug}/:id`, { ...withAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return proxyTo(target, `/api/v1/lookups/${slug}/${id}`, req, reply, req.userCtx);
  });
}

// Users
app.get('/users', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/users', req, reply, req.userCtx);
});
app.post('/users', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/users', req, reply, req.userCtx);
});
app.get('/users/assignable', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/users/assignable', req, reply, req.userCtx);
});
app.get('/users/team', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/users/team', req, reply, req.userCtx);
});
app.get('/users/org-chart', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/users/org-chart', req, reply, req.userCtx);
});
app.get('/users/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/users/${id}`, req, reply, req.userCtx);
});
app.patch('/users/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/users/${id}`, req, reply, req.userCtx);
});
app.delete('/users/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/users/${id}`, req, reply, req.userCtx);
});
app.post('/users/:id/reset-password', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/users/${id}/reset-password`, req, reply, req.userCtx);
});
app.get('/users/:id/org-mappings', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/users/${id}/org-mappings`, req, reply, req.userCtx);
});
app.post('/users/:id/org-mappings', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/users/${id}/org-mappings`, req, reply, req.userCtx);
});
app.delete('/users/:id/org-mappings/:orgId', { ...withAuth }, async (req, reply) => {
  const { id, orgId } = req.params as { id: string; orgId: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/users/${id}/org-mappings/${orgId}`, req, reply, req.userCtx);
});

// API clients (public-API key management — org admin and above, enforced in identity-service)
app.get('/api-clients', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/api-clients', req, reply, req.userCtx);
});
app.post('/api-clients', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/api-clients', req, reply, req.userCtx);
});
app.patch('/api-clients/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/api-clients/${id}`, req, reply, req.userCtx);
});
app.post('/api-clients/:id/rotate', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/api-clients/${id}/rotate`, req, reply, req.userCtx);
});
app.delete('/api-clients/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/api-clients/${id}`, req, reply, req.userCtx);
});

// Assignments
app.get('/assignments', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/assignments', req, reply, req.userCtx);
});
app.post('/assignments', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/assignments', req, reply, req.userCtx);
});
app.get('/assignments/mine', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/assignments/mine', req, reply, req.userCtx);
});
app.get('/assignments/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/assignments/${id}`, req, reply, req.userCtx);
});
app.patch('/assignments/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/assignments/${id}`, req, reply, req.userCtx);
});
app.delete('/assignments/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.leadsServiceUrl, `/api/v1/assignments/${id}`, req, reply, req.userCtx);
});

// Orgs & locations (identity-service, except /locations which is leads-service)
app.get('/orgs', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/orgs', req, reply, req.userCtx);
});
app.get('/orgs/all', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/orgs/all', req, reply, req.userCtx);
});
// Minimal org update (attendance geofence centre); org_admin+ enforced in identity-service.
app.patch('/orgs/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.identityServiceUrl, `/api/v1/orgs/${id}`, req, reply, req.userCtx);
});
app.get('/locations', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/locations', req, reply, req.userCtx);
});
app.get('/lead-sources', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.identityServiceUrl, '/api/v1/lead-sources', req, reply, req.userCtx);
});

// Activities (admin only — enforced server-side via RLS + rank check in leads-service)
app.get('/activities', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/activities', req, reply, req.userCtx);
});

// Analytics
app.get('/analytics/dashboard', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/analytics/dashboard', req, reply, req.userCtx);
});
app.get('/analytics/dashboard/campaigns', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/analytics/dashboard/campaigns', req, reply, req.userCtx);
});
app.get('/analytics/performance', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/analytics/performance', req, reply, req.userCtx);
});
app.get('/analytics/pipeline', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/analytics/pipeline', req, reply, req.userCtx);
});

// Meta CAPI (protected — manual conversion event trigger)
app.post('/meta/crm-event', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.metaServiceUrl, '/api/v1/crm-event', req, reply, req.userCtx);
});

// Meta integration management (protected — admin only)
app.get('/meta/integration', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.metaServiceUrl, '/api/v1/integration', req, reply, req.userCtx);
});
app.post('/meta/integration', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.metaServiceUrl, '/api/v1/integration', req, reply, req.userCtx);
});
app.patch('/meta/integration', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.metaServiceUrl, '/api/v1/integration', req, reply, req.userCtx);
});

// Communications
app.get('/communications/status', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.communicationServiceUrl, '/api/v1/communications/status', req, reply, req.userCtx);
});
app.post('/communications/email', { ...withCommsSend }, async (req, reply) => {
  return proxyTo(config.communicationServiceUrl, '/api/v1/communications/email', req, reply, req.userCtx);
});
app.post('/communications/whatsapp/text', { ...withCommsSend }, async (req, reply) => {
  return proxyTo(config.communicationServiceUrl, '/api/v1/communications/whatsapp/text', req, reply, req.userCtx);
});
app.post('/communications/whatsapp/template', { ...withCommsSend }, async (req, reply) => {
  return proxyTo(config.communicationServiceUrl, '/api/v1/communications/whatsapp/template', req, reply, req.userCtx);
});
app.post('/communications/send', { ...withCommsSend }, async (req, reply) => {
  return proxyTo(config.communicationServiceUrl, '/api/v1/communications/send', req, reply, req.userCtx);
});

// HR (employee profiles module — leave/attendance/tasks module-gated inside hr-service)
app.get('/hr/employees', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/employees', req, reply, req.userCtx);
});
app.post('/hr/employees', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/employees', req, reply, req.userCtx);
});
app.get('/hr/employees/departments', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/employees/departments', req, reply, req.userCtx);
});
app.post('/hr/employees/departments', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/employees/departments', req, reply, req.userCtx);
});
app.patch('/hr/employees/departments/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/employees/departments/${id}`, req, reply, req.userCtx);
});
app.get('/hr/employees/designations', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/employees/designations', req, reply, req.userCtx);
});
app.post('/hr/employees/designations', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/employees/designations', req, reply, req.userCtx);
});
app.patch('/hr/employees/designations/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/employees/designations/${id}`, req, reply, req.userCtx);
});
app.get('/hr/employees/:userId', { ...withAuth }, async (req, reply) => {
  const { userId } = req.params as { userId: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/employees/${userId}`, req, reply, req.userCtx);
});
app.patch('/hr/employees/:userId', { ...withAuth }, async (req, reply) => {
  const { userId } = req.params as { userId: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/employees/${userId}`, req, reply, req.userCtx);
});

// HR — Leave module (all module-gated by requireModule('leave') inside hr-service)
app.get('/hr/leave/ping', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/ping', req, reply, req.userCtx);
});

// Leave requests
app.post('/hr/leave/requests', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/requests', req, reply, req.userCtx);
});
app.get('/hr/leave/requests', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/requests', req, reply, req.userCtx);
});
// Read-only working-days preview (commits nothing) — used by ApplyLeaveModal to
// compute days_count/sufficient before enabling submit.
app.get('/hr/leave/requests/preview', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/requests/preview', req, reply, req.userCtx);
});
app.get('/hr/leave/requests/team', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/requests/team', req, reply, req.userCtx);
});
app.post('/hr/leave/requests/:id/approve', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/leave/requests/${id}/approve`, req, reply, req.userCtx);
});
app.post('/hr/leave/requests/:id/reject', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/leave/requests/${id}/reject`, req, reply, req.userCtx);
});
app.post('/hr/leave/requests/:id/cancel', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/leave/requests/${id}/cancel`, req, reply, req.userCtx);
});

// Leave balances & ledger
app.get('/hr/leave/balances', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/balances', req, reply, req.userCtx);
});
app.get('/hr/leave/balances/:userId', { ...withAuth }, async (req, reply) => {
  const { userId } = req.params as { userId: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/leave/balances/${userId}`, req, reply, req.userCtx);
});
app.get('/hr/leave/ledger', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/ledger', req, reply, req.userCtx);
});
app.post('/hr/leave/adjustments', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/adjustments', req, reply, req.userCtx);
});

// Leave policies
app.get('/hr/leave/policies', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/policies', req, reply, req.userCtx);
});
app.post('/hr/leave/policies', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/policies', req, reply, req.userCtx);
});
app.patch('/hr/leave/policies/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/leave/policies/${id}`, req, reply, req.userCtx);
});

// Leave settings
app.get('/hr/leave/settings', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/settings', req, reply, req.userCtx);
});
app.put('/hr/leave/settings', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/leave/settings', req, reply, req.userCtx);
});

// Holidays & holiday calendars
app.get('/hr/holidays', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/holidays', req, reply, req.userCtx);
});
app.post('/hr/holidays', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/holidays', req, reply, req.userCtx);
});
app.patch('/hr/holidays/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/holidays/${id}`, req, reply, req.userCtx);
});
app.get('/hr/holiday-calendars', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/holiday-calendars', req, reply, req.userCtx);
});
app.post('/hr/holiday-calendars', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/holiday-calendars', req, reply, req.userCtx);
});
app.patch('/hr/holiday-calendars/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/holiday-calendars/${id}`, req, reply, req.userCtx);
});

// HR — Attendance module (all module-gated by requireModule('attendance') inside hr-service)
app.post('/hr/attendance/check-in', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/check-in', req, reply, req.userCtx);
});
app.post('/hr/attendance/check-out', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/check-out', req, reply, req.userCtx);
});
app.get('/hr/attendance/rules', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/rules', req, reply, req.userCtx);
});
app.get('/hr/attendance/rules/admin', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/rules/admin', req, reply, req.userCtx);
});
app.put('/hr/attendance/rules/admin', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/rules/admin', req, reply, req.userCtx);
});
app.get('/hr/attendance/me', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/me', req, reply, req.userCtx);
});
app.get('/hr/attendance/team', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/team', req, reply, req.userCtx);
});
app.get('/hr/attendance/photos/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/attendance/photos/${id}`, req, reply, req.userCtx);
});
app.post('/hr/attendance/regularizations', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/regularizations', req, reply, req.userCtx);
});
app.get('/hr/attendance/regularizations', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/regularizations', req, reply, req.userCtx);
});
app.post('/hr/attendance/regularizations/:id/approve', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/attendance/regularizations/${id}/approve`, req, reply, req.userCtx);
});
app.post('/hr/attendance/regularizations/:id/reject', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/attendance/regularizations/${id}/reject`, req, reply, req.userCtx);
});
app.get('/hr/attendance/reports/summary', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/attendance/reports/summary', req, reply, req.userCtx);
});
// HR — Shifts & shift assignments (attendance module)
app.get('/hr/shifts', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/shifts', req, reply, req.userCtx);
});
app.post('/hr/shifts', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/shifts', req, reply, req.userCtx);
});
app.patch('/hr/shifts/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/shifts/${id}`, req, reply, req.userCtx);
});
app.get('/hr/shift-assignments', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/shift-assignments', req, reply, req.userCtx);
});
app.post('/hr/shift-assignments', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/shift-assignments', req, reply, req.userCtx);
});
app.patch('/hr/shift-assignments/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.hrServiceUrl, `/api/v1/shift-assignments/${id}`, req, reply, req.userCtx);
});

// HR — active module entitlements for the caller's tenant (drives the web module nav switcher)
app.get('/hr/modules', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/modules', req, reply, req.userCtx);
});
// HR — the caller's resolved HR product role/rank (hr.member_roles), distinct
// from the platform/session rank — drives HR-admin-only UI gating (Leave/
// Attendance "Admin" tabs) against the same authority the backend enforces.
app.get('/hr/me', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.hrServiceUrl, '/api/v1/me', req, reply, req.userCtx);
});

// ── Tasks / To-do (tasks-service, module-gated on 'tasks') ───────────────────
app.get('/task-lists', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.tasksServiceUrl, '/api/v1/task-lists', req, reply, req.userCtx);
});
app.post('/task-lists', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.tasksServiceUrl, '/api/v1/task-lists', req, reply, req.userCtx);
});
app.get('/task-lists/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/task-lists/${id}`, req, reply, req.userCtx);
});
app.patch('/task-lists/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/task-lists/${id}`, req, reply, req.userCtx);
});
app.delete('/task-lists/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/task-lists/${id}`, req, reply, req.userCtx);
});

app.get('/tasks/mine', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.tasksServiceUrl, '/api/v1/tasks/mine', req, reply, req.userCtx);
});
app.get('/tasks', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.tasksServiceUrl, '/api/v1/tasks', req, reply, req.userCtx);
});
app.post('/tasks', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.tasksServiceUrl, '/api/v1/tasks', req, reply, req.userCtx);
});
app.get('/tasks/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/tasks/${id}`, req, reply, req.userCtx);
});
app.patch('/tasks/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/tasks/${id}`, req, reply, req.userCtx);
});
app.delete('/tasks/:id', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/tasks/${id}`, req, reply, req.userCtx);
});
app.get('/tasks/:id/comments', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/tasks/${id}/comments`, req, reply, req.userCtx);
});
app.post('/tasks/:id/comments', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/tasks/${id}/comments`, req, reply, req.userCtx);
});
app.get('/tasks/:id/status-history', { ...withAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  return proxyTo(config.tasksServiceUrl, `/api/v1/tasks/${id}/status-history`, req, reply, req.userCtx);
});

// Legacy URL aliases (monolith used /api/dashboard and /api/org/performance)
app.get('/dashboard', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/analytics/dashboard', req, reply, req.userCtx);
});
app.get('/dashboard/campaigns', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/analytics/dashboard/campaigns', req, reply, req.userCtx);
});
app.get('/org/performance', { ...withAuth }, async (req, reply) => {
  return proxyTo(config.leadsServiceUrl, '/api/v1/analytics/performance', req, reply, req.userCtx);
});

const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const stop = async () => {
  app.log.info('Graceful shutdown initiated');
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

start();
