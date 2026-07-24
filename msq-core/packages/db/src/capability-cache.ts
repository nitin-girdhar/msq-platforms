import { sql } from 'drizzle-orm';
import type { CapabilityKey } from '@platform/rbac';
import { appDrizzle, type DrizzleTx } from './drizzle.js';
import { pgListen } from './notify.js';

// ── Tier C3: the DB-driven capability TREE, cached in process ───────────────
//
// Access rules live in iam.capabilities + iam.role_capabilities and are resolved
// per tenant by iam.fn_role_capability_matrix, which walks the tree and hands back
// a definite boolean per node — ancestor denials already applied. A service loads
// a tenant's matrix on first use and holds it; changing who may do what is then a
// DB write plus an invalidation, not a deploy.
//
// The cache stores only the keys that resolved TRUE. Scope resolution (the
// broadest granted rung of an operation's ladder) happens in @platform/rbac's
// resolveScope() against that same set, so there is one representation, not two.
//
// Freshness has three independent mechanisms, deliberately layered so no single
// one has to be perfect:
//   1. LISTEN/NOTIFY  — a statement-level trigger on the two tables fires
//                       'rbac_capabilities_changed'; listeners drop everything.
//                       This is the fast path (sub-second).
//   2. TTL            — entries expire after CACHE_TTL_MS regardless. This is the
//                       backstop for a dropped LISTEN connection, a service that
//                       never managed to LISTEN, or a write applied by psql on a
//                       different database node.
//   3. Restart        — always sufficient, never required.
//
// Deliberately NOT a per-request query: these gates run on nearly every request,
// and a per-request round trip would put the authz decision in the latency path
// of every page render.

const CHANNEL = 'rbac_capabilities_changed';
const CACHE_TTL_MS = 5 * 60_000;

interface TenantMatrix {
  loadedAt: number;
  /** role name → the capability keys that role effectively holds. */
  byRole: Map<string, Set<string>>;
}

const cache = new Map<string, TenantMatrix>();
/** De-dupes concurrent first-loads for the same tenant into one query. */
const inFlight = new Map<string, Promise<TenantMatrix>>();
let listening = false;

// Same role selection as member-role.ts's runResolver: the matrix function is
// SECURITY DEFINER, so it needs EXECUTE and schema USAGE but no session GUCs,
// and a NOINHERIT product login (lms_svc/hr_svc/task_svc) must not SET ROLE.
async function runResolver<T>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return appDrizzle().transaction(async (tx) => {
    if (process.env['DB_PRODUCT_SCOPED_LOGIN'] !== 'true') {
      await tx.execute(sql.raw('SET LOCAL ROLE app_user'));
    }
    return fn(tx);
  });
}

async function loadMatrix(tenantId: string): Promise<TenantMatrix> {
  const rows = (await runResolver((tx) =>
    tx.execute(
      sql`SELECT role_name, capability_key, granted
          FROM iam.fn_role_capability_matrix(${tenantId}::uuid)`,
    ),
  )) as unknown as Array<{ role_name: string; capability_key: string; granted: boolean }>;

  const byRole = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.granted) continue;
    let keys = byRole.get(row.role_name);
    if (!keys) {
      keys = new Set<string>();
      byRole.set(row.role_name, keys);
    }
    keys.add(row.capability_key);
  }
  return { loadedAt: Date.now(), byRole };
}

async function getMatrix(tenantId: string): Promise<TenantMatrix> {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

  const pending = inFlight.get(tenantId);
  if (pending) return pending;

  const load = loadMatrix(tenantId)
    .then((matrix) => {
      cache.set(tenantId, matrix);
      return matrix;
    })
    .finally(() => {
      inFlight.delete(tenantId);
    });
  inFlight.set(tenantId, load);
  return load;
}

/**
 * Does `roleName` hold `key` in this tenant?
 *
 * Fails CLOSED: an unknown role, an unseeded capability, or a role with no grant
 * row all return false. That is why db_scripts/07 seeds a default grant for every
 * key in @platform/rbac's CAPABILITY map — a key that exists in code but not in
 * the DB denies everyone rather than allowing everyone.
 */
export async function hasCapability(
  tenantId: string,
  roleName: string | null,
  key: CapabilityKey,
): Promise<boolean> {
  if (!roleName) return false;
  const matrix = await getMatrix(tenantId);
  return matrix.byRole.get(roleName)?.has(key) ?? false;
}

/**
 * Cache-BYPASSING capability check — resolves straight from
 * iam.fn_role_capability_matrix, exactly like /auth/me does, ignoring the
 * in-process TTL cache entirely.
 *
 * Use this ONLY for high-sensitivity, low-traffic endpoints where a revoke must
 * be honored immediately and the ≤5-minute cache staleness window is
 * unacceptable — e.g. issuing/rotating API credentials (see openissues.md
 * Issue #2). It does one DB round trip per call, so it is deliberately NOT the
 * default gate used on every request. Fails CLOSED like `hasCapability`.
 */
export async function hasCapabilityFresh(
  tenantId: string,
  roleName: string | null,
  key: CapabilityKey,
): Promise<boolean> {
  if (!roleName) return false;
  const rows = (await runResolver((tx) =>
    tx.execute(
      sql`SELECT granted
          FROM iam.fn_role_capability_matrix(${tenantId}::uuid)
          WHERE role_name = ${roleName} AND capability_key = ${key}
          LIMIT 1`,
    ),
  )) as unknown as Array<{ granted: boolean }>;
  return rows[0]?.granted ?? false;
}

/** Every capability `roleName` holds — for handing the set to a client so the UI
 *  can hide what the server would refuse, instead of rendering it and 403-ing. */
export async function capabilitiesFor(
  tenantId: string,
  roleName: string | null,
): Promise<string[]> {
  if (!roleName) return [];
  const matrix = await getMatrix(tenantId);
  return [...(matrix.byRole.get(roleName) ?? [])];
}

/** Drop cached matrices. No argument clears every tenant. */
export function invalidateCapabilityCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * Subscribe to capability changes. Call once during service startup, after the
 * DB pools are configured.
 *
 * Best-effort by design: if the LISTEN connection cannot be established (no
 * DATABASE_URL_SERVICE, DB not reachable yet) this logs and returns rather than
 * failing startup — the TTL still bounds staleness, so the service degrades from
 * "seconds" to "minutes" instead of refusing to boot over a cache optimisation.
 */
export async function startCapabilityCache(): Promise<boolean> {
  if (listening) return true;
  listening = true;
  try {
    await pgListen(CHANNEL, () => {
      invalidateCapabilityCache();
    });
    return true;
  } catch (err) {
    listening = false;
    console.warn(
      `[rbac] capability cache LISTEN unavailable; falling back to ${CACHE_TTL_MS / 1000}s TTL`,
      err,
    );
    // Returning false lets the caller assert/surface the degraded state at boot
    // (see openissues.md Issue #2). Fresh-resolving gates (hasCapabilityFresh) are
    // unaffected either way; only the cached hasCapability path relies on this
    // subscription for sub-second invalidation.
    return false;
  }
}
