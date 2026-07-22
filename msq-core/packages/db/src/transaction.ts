import { sql } from 'drizzle-orm';
import { appDrizzle, tenantDrizzle, serviceDrizzle, type DrizzleTx } from './drizzle.js';

export type { DrizzleTx };

export interface RoleTxContext {
  role: string;
  org_id: string;
  tenant_id: string;
  user_id: string;
  // Defense-in-depth (P0 #1): when true the transaction runs under the
  // `readonly_user` PG role and is set transaction_read_only, so the DB itself
  // rejects any INSERT/UPDATE/DELETE even if an app-layer authorization check is
  // ever missed. readonly_user INHERITs app_user, so every `TO app_user` RLS
  // SELECT policy still applies unchanged — read visibility is identical, only
  // writes are blocked. Set by callers for read-only actors (product rank 0).
  readOnly?: boolean;
}

export async function withRoleTx<T>(ctx: RoleTxContext, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  if (ctx.role === 'super_admin') {
    return serviceDrizzle().transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
      if (ctx.org_id) await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
      if (ctx.tenant_id) await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenant_id}, true)`);
      return fn(tx);
    });
  }
  if (ctx.role === 'tenant_admin') {
    return tenantDrizzle().transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE tenant_admin`));
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenant_id}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
      // Set org_id so audit triggers and any org-scoped policy checks have context.
      // For tenant_admin the tenant_isolation_policy already governs cross-org access;
      // this does not restrict them to a single org.
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
      return fn(tx);
    });
  }
  return appDrizzle().transaction(async (tx) => {
    // Product-scoped logins (lms_svc/hr_svc/task_svc — see
    // db_scripts/19_init-per-product-db-grants.sql) must NOT switch to the
    // shared app_user role: app_user's own grants span every product's
    // schema, so doing so would undo the per-product GRANT-level isolation
    // (D8) these logins exist for. They already satisfy every
    // `TO app_user` RLS policy via role membership alone (membership checks
    // ignore INHERIT), so skipping this SET ROLE only drops the *extra*
    // cross-schema privileges app_user would otherwise hand them — RLS
    // enforcement is unaffected.
    if (ctx.readOnly) {
      // readonly_user INHERITs app_user (see db_scripts/01), so all `TO app_user`
      // RLS policies still apply and reads are unaffected; the read-only tx makes
      // any write physically fail. Product-scoped logins (NOINHERIT) are named in
      // the RLS policies directly and stay on app_user membership — for them we
      // only flip the transaction to read-only.
      if (process.env['DB_PRODUCT_SCOPED_LOGIN'] !== 'true') {
        await tx.execute(sql.raw(`SET LOCAL ROLE readonly_user`));
      }
      await tx.execute(sql.raw(`SET LOCAL transaction_read_only = on`));
    } else if (process.env['DB_PRODUCT_SCOPED_LOGIN'] !== 'true') {
      await tx.execute(sql.raw(`SET LOCAL ROLE app_user`));
    }
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.org_id}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`);
    return fn(tx);
  });
}

export async function withServiceTx<T>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return serviceDrizzle().transaction(fn);
}

// Admin config path (N-6): a super_admin managing a SELECTED tenant's product
// lookups/roles. Runs as the product-scoped login (member of app_user) with
// app.current_tenant_id pinned to the target tenant — NOT root_service/BYPASSRLS.
// The tenant-scoped admin write RLS policies (db_scripts/25, keyed on
// app.current_tenant_id) then make it physically impossible to read or write any
// other tenant's rows. `tenantId` is the admin-selected tenant, never the actor's
// own — the actor is a platform super_admin acting cross-tenant by choice.
//
// Callers MUST enforce the super_admin authorization gate before using this
// (belt-and-suspenders with the RLS): this helper only pins tenant context, it
// does not check who the actor is.
export async function withTenantConfigTx<T>(
  params: { actorUserId: string; tenantId: string },
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return appDrizzle().transaction(async (tx) => {
    // Same rationale as withRoleTx's app_user branch: product-scoped logins keep
    // their narrow per-product grants (D8) and satisfy `TO app_user` policies via
    // membership, so only non-product-scoped services SET ROLE app_user here.
    if (process.env['DB_PRODUCT_SCOPED_LOGIN'] !== 'true') {
      await tx.execute(sql.raw(`SET LOCAL ROLE app_user`));
    }
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${params.tenantId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${params.actorUserId}, true)`);
    return fn(tx);
  });
}
