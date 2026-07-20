import type { FastifyRequest, FastifyReply } from 'fastify';
import { hashApiKey, getApiClientByHash, recordApiClientUsage, type ResolvedApiClient } from '@crm/db';
import type { ApiScope } from '@crm/auth-constants';
import { config } from '../config.js';
import type { UserContext } from './proxy.js';

declare module 'fastify' {
  interface FastifyRequest {
    publicClient?: ResolvedApiClient;
  }
}

function extractKey(request: FastifyRequest): string | undefined {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const apiKey = request.headers['x-api-key'];
  return typeof apiKey === 'string' ? apiKey.trim() : undefined;
}

// ── Per-key fixed-window rate limiter ────────────────────────────────────────
interface Window { count: number; resetAt: number }
const keyBuckets = new Map<string, Window>();

function overRateLimit(clientId: string, perMinute: number): number | null {
  const now = Date.now();
  let win = keyBuckets.get(clientId);
  if (!win || win.resetAt <= now) {
    win = { count: 0, resetAt: now + 60_000 };
    keyBuckets.set(clientId, win);
    if (keyBuckets.size > 10_000) {
      for (const [k, w] of keyBuckets) if (w.resetAt <= now) keyBuckets.delete(k);
    }
  }
  win.count += 1;
  return win.count > perMinute ? Math.ceil((win.resetAt - now) / 1000) : null;
}

/**
 * Authenticates a public/partner API request by API key and enforces the
 * required scope + the client's per-key rate limit. On success, attaches the
 * resolved client to `request.publicClient`. The client's tenant/org binding is
 * the source of truth for isolation — never the request body.
 */
export function publicApiKeyAuth(requiredScope: ApiScope) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!config.publicApiKeyPepper) {
      return reply.status(503).send({ error: 'Public API is not configured' });
    }

    const raw = extractKey(request);
    if (!raw) {
      return reply.status(401).send({ error: 'API key required' });
    }

    const client = await getApiClientByHash(hashApiKey(raw, config.publicApiKeyPepper));
    if (!client || !client.is_active || client.revoked_at) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }
    if (client.expires_at && new Date(client.expires_at).getTime() <= Date.now()) {
      return reply.status(401).send({ error: 'API key has expired' });
    }

    if (!client.scopes.includes(requiredScope)) {
      return reply.status(403).send({ error: `API key is missing required scope: ${requiredScope}` });
    }

    const retryAfter = overRateLimit(client.id, client.rate_limit_per_min);
    if (retryAfter !== null) {
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({ error: 'Rate limit exceeded' });
    }

    request.publicClient = client;
    // Best-effort usage stamp; never block the request on it.
    void recordApiClientUsage(client.id).catch(() => {});
  };
}

// Builds the internal identity headers for a public API call from the resolved
// client. The synthetic actor is minimally privileged (rank 0); authorization is
// the scope, isolation is the tenant/org binding.
//
// A key bound to exactly one branch gets X-Org-Id set directly (unchanged
// behaviour for simple single-branch keys). A key bound to a subset of
// branches, or scoped to the whole tenant, leaves X-Org-Id empty — the caller
// must supply a branch_id per request, validated downstream against the
// X-Allowed-Org-Ids / X-Scope-All-Orgs headers (see publicScopeHeaders).
export function publicUserContext(client: ResolvedApiClient): UserContext {
  const singleOrg = !client.scope_all_orgs && client.org_ids.length === 1 ? client.org_ids[0] : undefined;
  // Synthetic actor for the public/partner API. platform_role is 'member' (least
  // privileged); the public downstream routes are scope-gated (publicScopeHeaders)
  // and tenant/org-bound, not platform_role-driven.
  return {
    user_id: `api_client:${client.id}`,
    platform_role: 'member',
    org_id: singleOrg ?? '',
    tenant_id: client.tenant_id,
  };
}

// Extra headers carrying the full branch scope for multi-branch/tenant-wide
// keys, so downstream services can validate a caller-supplied branch_id
// without an extra DB round trip (the ids were already validated against the
// tenant when the key was created/edited).
export function publicScopeHeaders(client: ResolvedApiClient): Record<string, string> {
  const singleOrg = !client.scope_all_orgs && client.org_ids.length === 1;
  if (singleOrg) return {};
  return {
    'X-Allowed-Org-Ids': client.org_ids.join(','),
    'X-Scope-All-Orgs': client.scope_all_orgs ? 'true' : 'false',
  };
}
