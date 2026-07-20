import type { SessionUser, ProductKey } from '@platform/types';

// ── Product entitlement primitive (D6) ──────────────────────────────────────
// "Does this tenant have this product enabled?" — backed by entity.tenant_modules
// via a cached read (PR-C). The actual DB access is *injected* (configureProduct-
// Source) rather than imported: this package is also consumed by the Next.js
// frontends (apps/web, apps/lookup-admin), and a static @platform/db dependency would
// pull the pg driver into the browser bundle. Backends wire the source at startup.

// ProductKey is defined in @platform/types (shared with the shrunk JWT's
// licensed_products) and re-exported here so existing `@platform/authz` imports
// keep resolving.
export type { ProductKey };

/** Thrown by {@link assertProduct} when a tenant lacks an active product. HTTP 403. */
export class ProductForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(public readonly product: ProductKey) {
    super(`Product '${product}' is not enabled for this tenant`);
    this.name = 'ProductForbiddenError';
  }
}

// The table stores fine-grained *modules* (lms | leave | attendance | tasks);
// products are coarser. HR is active if either HR sub-module is licensed.
export function modulesToProducts(modules: readonly string[]): Set<ProductKey> {
  const products = new Set<ProductKey>();
  if (modules.includes('lms')) products.add('lms');
  if (modules.includes('leave') || modules.includes('attendance')) products.add('hr');
  if (modules.includes('tasks')) products.add('task');
  return products;
}

// ── Injected data source + per-tenant cache ─────────────────────────────────

type ModuleReader = (tenantId: string) => Promise<string[]>;

let readActiveModules: ModuleReader | null = null;

/**
 * Wire the entity.tenant_modules read (typically @platform/db's
 * `getActiveTenantModulesByTenantId`). Call once at backend startup before any
 * {@link getTenantProducts}/{@link hasProduct} call.
 */
export function configureProductSource(reader: ModuleReader): void {
  readActiveModules = reader;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { products: Set<ProductKey>; expiresAt: number }>();

/** Test/ops hook: drop a tenant's cached entitlement (e.g. after a plan change). */
export function invalidateTenantProducts(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** Active products for a tenant, cached 60s. Requires {@link configureProductSource}. */
export async function getTenantProducts(tenantId: string): Promise<Set<ProductKey>> {
  if (!readActiveModules) {
    throw new Error('Product source not configured — call configureProductSource() at startup');
  }
  const now = Date.now();
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.products;

  const products = modulesToProducts(await readActiveModules(tenantId));
  cache.set(tenantId, { products, expiresAt: now + CACHE_TTL_MS });
  return products;
}

/**
 * Whether the acting user's tenant has `product` enabled. Async: backed by a
 * cached read of entity.tenant_modules.
 */
export async function hasProduct(session: SessionUser, product: ProductKey): Promise<boolean> {
  return (await getTenantProducts(session.tenant_id)).has(product);
}

/** Assert the tenant has `product` enabled, else throw {@link ProductForbiddenError} (403). */
export async function assertProduct(session: SessionUser, product: ProductKey): Promise<void> {
  if (!(await hasProduct(session, product))) throw new ProductForbiddenError(product);
}
