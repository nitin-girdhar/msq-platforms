import { sql } from 'drizzle-orm';
import { withServiceTx, sqlUuidArr } from '@platform/db';

// Public read endpoints run under the service role but with a MANDATORY explicit
// tenant filter and a whitelisted column list — never the tenant_admin role, and
// never SELECT *. The tenant/branch come from the verified API key, not the body.

// geo.* is tenant-scoped, so every join below is qualified on tenant_id as
// well as id — withServiceTx bypasses RLS, and the composite FK is not the
// thing being relied on here.
//
// `city` (free-text) is kept in the projection so existing callers keep
// working; `city_name` is the authoritative one, resolved through city_id.
//
// LEFT joins, not inner: a branch with no geo FK set must still be returned,
// with nulls.
//
// orgIds: null = every branch of the tenant; otherwise only these (already
// validated against the key's scope). An empty set reaches nothing.
export async function listBranches(tenantId: string, orgIds: string[] | null, filter: GeoFilter = {}) {
  if (orgIds && orgIds.length === 0) return [];
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT o.id, o.name, o.brand_name, o.city, o.timezone, o.is_active,
             o.country_id, co.name AS country_name,
             o.state_id,   st.name AS state_name,
             o.city_id,    ci.name AS city_name
      FROM entity.organizations o
      LEFT JOIN geo.cities    ci ON ci.id = o.city_id    AND ci.tenant_id = o.tenant_id
      LEFT JOIN geo.states    st ON st.id = o.state_id   AND st.tenant_id = o.tenant_id
      LEFT JOIN geo.countries co ON co.id = o.country_id AND co.tenant_id = o.tenant_id
      WHERE o.tenant_id = ${tenantId}::uuid
        AND NOT o.is_deleted
        ${orgIds ? sql`AND o.id = ANY(${sqlUuidArr(orgIds)})` : sql``}
        ${filter.cityIds?.length   ? sql`AND o.city_id    = ANY(${sqlUuidArr(filter.cityIds)})`    : sql``}
        ${filter.stateIds?.length   ? sql`AND o.state_id   = ANY(${sqlUuidArr(filter.stateIds)})`   : sql``}
        ${filter.countryIds?.length ? sql`AND o.country_id = ANY(${sqlUuidArr(filter.countryIds)})` : sql``}
      ORDER BY o.name
    `)) as Array<Record<string, unknown>>;
  });
}

// ── Tenant presence: where does this tenant operate? ─────────────────────────
//
// Every filter is optional and drilling is skippable: /cities with only a
// country_id joins up through geo.states, so "every city in India" is one call
// with no state named.
//
// Only is_active rows. geo has no hard delete (07_grants.sql grants none), so
// a place a tenant has removed is still in the table and must never surface on
// a public endpoint.
//
// branch_count is the same join /branches filters on, pre-aggregated, so a
// caller can render "Haryana (16)" without N+1 requests. has_branches filters
// on it: FitClass lists Punjab as a presence with no centre in it, so the
// default listing includes Punjab and has_branches=true does not.

export interface GeoFilter {
  cityIds?:    string[];
  stateIds?:   string[];
  countryIds?: string[];
}

export interface PresenceOptions extends GeoFilter {
  orgId?: string;
  hasBranches?: boolean;
}

export async function listCountries(tenantId: string, opts: PresenceOptions = {}) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT co.id, co.name, co.iso_code, COUNT(o.id)::int AS branch_count
      FROM geo.countries co
      LEFT JOIN entity.organizations o
        ON o.country_id = co.id AND o.tenant_id = co.tenant_id
       AND NOT o.is_deleted AND o.is_active
       ${opts.orgId ? sql`AND o.id = ${opts.orgId}::uuid` : sql``}
      WHERE co.tenant_id = ${tenantId}::uuid AND co.is_active
      GROUP BY co.id, co.name, co.iso_code
      ${opts.hasBranches ? sql`HAVING COUNT(o.id) > 0` : sql``}
      ORDER BY co.name
      LIMIT 500
    `)) as Array<Record<string, unknown>>;
  });
}

export async function listStates(tenantId: string, opts: PresenceOptions = {}) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT st.id, st.name, st.code, st.country_id, co.name AS country_name,
             COUNT(o.id)::int AS branch_count
      FROM geo.states st
      JOIN geo.countries co ON co.id = st.country_id AND co.tenant_id = st.tenant_id AND co.is_active
      LEFT JOIN entity.organizations o
        ON o.state_id = st.id AND o.tenant_id = st.tenant_id
       AND NOT o.is_deleted AND o.is_active
       ${opts.orgId ? sql`AND o.id = ${opts.orgId}::uuid` : sql``}
      WHERE st.tenant_id = ${tenantId}::uuid AND st.is_active
        ${opts.countryIds?.length ? sql`AND st.country_id = ANY(${sqlUuidArr(opts.countryIds)})` : sql``}
      GROUP BY st.id, st.name, st.code, st.country_id, co.name
      ${opts.hasBranches ? sql`HAVING COUNT(o.id) > 0` : sql``}
      ORDER BY st.name
      LIMIT 500
    `)) as Array<Record<string, unknown>>;
  });
}

export async function listCities(tenantId: string, opts: PresenceOptions = {}) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT ci.id, ci.name, ci.state_id, st.name AS state_name,
             st.country_id, co.name AS country_name,
             COUNT(o.id)::int AS branch_count
      FROM geo.cities ci
      JOIN geo.states    st ON st.id = ci.state_id    AND st.tenant_id = ci.tenant_id AND st.is_active
      JOIN geo.countries co ON co.id = st.country_id  AND co.tenant_id = st.tenant_id AND co.is_active
      LEFT JOIN entity.organizations o
        ON o.city_id = ci.id AND o.tenant_id = ci.tenant_id
       AND NOT o.is_deleted AND o.is_active
       ${opts.orgId ? sql`AND o.id = ${opts.orgId}::uuid` : sql``}
      WHERE ci.tenant_id = ${tenantId}::uuid AND ci.is_active
        ${opts.stateIds?.length   ? sql`AND ci.state_id   = ANY(${sqlUuidArr(opts.stateIds)})`   : sql``}
        ${opts.countryIds?.length ? sql`AND st.country_id = ANY(${sqlUuidArr(opts.countryIds)})` : sql``}
      GROUP BY ci.id, ci.name, ci.state_id, st.name, st.country_id, co.name
      ${opts.hasBranches ? sql`HAVING COUNT(o.id) > 0` : sql``}
      ORDER BY ci.name
      LIMIT 500
    `)) as Array<Record<string, unknown>>;
  });
}

// Joins through iam.user_org_mapping (not the legacy iam.users.role_id
// mirror) so role_label reflects the role held in the branch being queried —
// the same source of truth users.repository.ts's internal listUsers uses.
//
// One row per (user, branch membership); branch_id is the membership's branch
// and org_id the user's home branch. Both the home branch AND the membership's
// branch must be in the tenant, so a membership another tenant granted can
// never surface here. The department is the one of the role held in that
// branch (iam.user_roles.department_id), joined on tenant too.
export interface UserFilter {
  departmentIds?: string[];
  managerIds?:    string[];
}

export async function listUsers(tenantId: string, orgIds: string[] | null, filter: UserFilter = {}) {
  if (orgIds && orgIds.length === 0) return [];
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT u.id, u.full_name, u.email, u.mobile AS phone, u.org_id,
             uom.org_id AS branch_id, bo.name AS branch_name,
             ur.label AS role_label, u.is_active,
             ur.department_id, d.name AS department_name, d.label AS department_label,
             u.manager_id, m.full_name AS manager_name
      FROM iam.user_org_mapping uom
      JOIN iam.users u             ON u.id  = uom.user_id
      JOIN iam.user_roles ur       ON ur.id = uom.role_id
      JOIN entity.organizations o  ON o.id  = u.org_id
      JOIN entity.organizations bo ON bo.id = uom.org_id AND bo.tenant_id = o.tenant_id
      LEFT JOIN iam.departments d  ON d.id  = ur.department_id AND d.tenant_id = o.tenant_id
      LEFT JOIN iam.users m        ON m.id  = u.manager_id
      WHERE o.tenant_id = ${tenantId}::uuid
        AND NOT o.is_deleted
        AND NOT bo.is_deleted
        AND NOT u.is_deleted
        AND uom.is_active
        ${orgIds ? sql`AND uom.org_id = ANY(${sqlUuidArr(orgIds)})` : sql``}
        ${filter.departmentIds?.length ? sql`AND ur.department_id = ANY(${sqlUuidArr(filter.departmentIds)})` : sql``}
        ${filter.managerIds?.length    ? sql`AND u.manager_id     = ANY(${sqlUuidArr(filter.managerIds)})`    : sql``}
      ORDER BY u.full_name, bo.name
    `)) as Array<Record<string, unknown>>;
  });
}

// The subset of orgIds that are live branches of the tenant. Used to validate
// a tenant-wide key's ?branch_id list in one round trip.
export async function orgsBelongingToTenant(orgIds: string[], tenantId: string): Promise<string[]> {
  if (orgIds.length === 0) return [];
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id FROM entity.organizations
      WHERE id = ANY(${sqlUuidArr(orgIds)}) AND tenant_id = ${tenantId}::uuid AND NOT is_deleted
    `)) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  });
}

export async function orgBelongsToTenant(orgId: string, tenantId: string): Promise<boolean> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1 FROM entity.organizations
      WHERE id = ${orgId}::uuid AND tenant_id = ${tenantId}::uuid AND NOT is_deleted
      LIMIT 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  });
}
