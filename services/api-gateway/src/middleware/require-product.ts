import type { FastifyRequest, FastifyReply } from 'fastify';
import { getTenantProducts } from '@platform/authz';
import { productForRoute } from '../lib/product-map.js';

// D6 central entitlement gate. Runs after authPreHandler (which sets req.userCtx
// from the verified JWT). If the route maps to a product the caller's tenant has
// not licensed, reject with 403 before proxying upstream. Ungated routes and
// unauthenticated requests pass straight through. Backed by a 60s per-tenant
// cache in @platform/authz, so this adds a query at most once per tenant per
// minute. Per-service require-module middleware remains as defense-in-depth.
export async function productGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // No verified user context (e.g. authPreHandler already replied 401) → nothing to gate.
  const tenantId = request.userCtx?.tenant_id;
  if (!tenantId) return;

  const routeUrl = request.routeOptions?.url ?? request.url;
  const product = productForRoute(routeUrl);
  if (!product) return;

  const products = await getTenantProducts(tenantId);
  if (!products.has(product)) {
    return reply.status(403).send({ error: 'PRODUCT_NOT_ENABLED', product });
  }
}
