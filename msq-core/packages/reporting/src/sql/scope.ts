// ── Row scoping ──────────────────────────────────────────────────────────────
// Layers 2 and 3 of four. The full stack, outermost first:
//
//   1. RLS          — withRoleTx sets app.current_org_id / _tenant_id / _user_id
//                     and the role; the reporting views are security_invoker, so
//                     the underlying tables' org/tenant policies filter rows in
//                     the database. (The CALLER sets this up, not this package.)
//   2. Org/tenant   — this file. ALWAYS ANDed. Not optional, not spec-derived.
//   3. Capability   — this file. resolveScope() narrows to own/team.
//   4. Grants       — per-product PG login; a dataset naming a relation its
//                     login lacks SELECT on fails at the database.
//
// Why layer 2 exists when layer 1 already filters: RLS depends on a GUC being
// set correctly by every caller, on the view actually being security_invoker,
// and on the policy existing on every underlying table of a multi-join view. A
// literal `org_id = $1` in the query needs none of those to be true. When they
// disagree the query returns nothing, which is the safe direction to fail.

import { sql, type SQL } from 'drizzle-orm';
import { resolveScope, type CapabilityHolder, type ScopeName } from '@platform/rbac';
import type { DatasetDef } from './dataset.js';
import { ReportError } from './errors.js';

export interface ReportQueryContext {
  /** Carries the resolved capability list. From /auth/me or request.auth. */
  actor: CapabilityHolder;
  /** The actor's platform role, as withRoleTx understands it. Determines
   *  whether a tenant-wide read is even possible. */
  role: string;
  orgId: string;
  tenantId: string;
  userId: string;
  /** The org's IANA timezone (entity.organizations.timezone). Resolved by the
   *  caller; spec.timezone overrides it when present. */
  orgTimezone?: string;
  /** Read across the whole tenant rather than one org. Legal only for
   *  tenant_admin/super_admin AND only on a dataset declaring scope.tenant. */
  tenantWide?: boolean;
}

const TENANT_WIDE_ROLES: readonly string[] = ['tenant_admin', 'super_admin'];

/**
 * The org (or tenant) predicate. Always present in the WHERE clause.
 *
 * A tenant-wide read is gated twice: the actor's role must permit it AND the
 * dataset must declare a tenant column. A dataset without one cannot be read
 * tenant-wide at all — we reject rather than silently falling back to the
 * actor's single org, because a tenant admin who asked for the tenant and
 * received one org would draw a conclusion from an incomplete chart.
 */
export function tenancyPredicate(def: DatasetDef, ctx: ReportQueryContext): SQL {
  if (ctx.tenantWide === true) {
    if (!TENANT_WIDE_ROLES.includes(ctx.role)) {
      throw new ReportError('forbidden', 'Tenant-wide reporting requires a tenant administrator.');
    }
    if (def.scope.tenant === undefined) {
      throw new ReportError(
        'invalid_spec',
        `Dataset '${def.key}' cannot be reported tenant-wide — it has no tenant column.`,
      );
    }
    if (ctx.tenantId === '') {
      throw new ReportError('invalid_spec', 'Tenant-wide reporting requires a tenant id.');
    }
    return sql`${def.scope.tenant} = ${ctx.tenantId}::uuid`;
  }

  if (ctx.orgId === '') {
    throw new ReportError('invalid_spec', 'A report requires an organization context.');
  }
  return sql`${def.scope.org} = ${ctx.orgId}::uuid`;
}

export interface ResolvedScope {
  name: ScopeName;
  /** Null when the scope needs no extra predicate (org/tenant/all). */
  predicate: SQL | null;
}

/**
 * Narrow rows to what the actor's capability scope permits.
 *
 * A dataset that declares no `scopeOperation` is org-wide for anyone who can
 * see it at all — that is a deliberate declaration, not an oversight, and is
 * correct for datasets that are already aggregate (a monthly summary view).
 *
 * The hard rule: if the actor resolves to a scope the dataset has no column
 * for, this THROWS. Falling back to a broader scope would hand out rows the
 * actor cannot see elsewhere in the product, and falling back to a narrower one
 * would produce a chart that silently disagrees with their own list view.
 */
export function capabilityScope(def: DatasetDef, ctx: ReportQueryContext): ResolvedScope {
  if (def.scopeOperation === undefined) {
    return { name: ctx.tenantWide === true ? 'tenant' : 'org', predicate: null };
  }

  const scope = resolveScope(ctx.actor, def.scopeOperation);
  if (scope === null) {
    throw new ReportError(
      'forbidden',
      `You do not hold any scope under '${def.scopeOperation}', so this report cannot be run.`,
    );
  }

  switch (scope) {
    case 'own': {
      if (def.scope.owner === undefined) {
        throw new ReportError(
          'forbidden',
          `Your access is limited to your own records, and '${def.label}' cannot be filtered that way.`,
        );
      }
      return { name: scope, predicate: sql`${def.scope.owner} = ${ctx.userId}::uuid` };
    }
    case 'team': {
      if (def.scope.teamMember === undefined) {
        throw new ReportError(
          'forbidden',
          `Your access is limited to your team, and '${def.label}' cannot be filtered that way.`,
        );
      }
      // iam.vw_user_team_members is (manager_id, member_id, org_id) — the same
      // view hr.can_approve_leave_request() uses (db_scripts/03_product_schema.sql).
      // The org_id predicate keeps a manager who manages people in two orgs from
      // pulling the other org's members into this org's report.
      // NOTE: each product login needs GRANT SELECT on this view; lms_svc
      // already has it (db_scripts/04_roles_and_grants.sql:597).
      return {
        name: scope,
        predicate: sql`${def.scope.teamMember} IN (
          SELECT tm.member_id FROM iam.vw_user_team_members tm
          WHERE tm.manager_id = ${ctx.userId}::uuid AND tm.org_id = ${ctx.orgId}::uuid
        )`,
      };
    }
    case 'org':
    case 'tenant':
    case 'all':
      // Layer 2 already bounds these; nothing further to add. 'all' does NOT
      // mean cross-org here — the tenancy predicate still applies, because a
      // report is always run in an org (or tenant) context.
      return { name: scope, predicate: null };
  }
}
