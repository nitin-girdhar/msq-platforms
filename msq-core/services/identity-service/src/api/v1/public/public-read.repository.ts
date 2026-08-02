import { sql } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';

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
export async function listBranches(tenantId: string, orgId?: string, filter: GeoFilter = {}) {
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
        ${orgId ? sql`AND o.id = ${orgId}::uuid` : sql``}
        ${filter.cityIds?.length    ? sql`AND o.city_id    = ANY(${filter.cityIds}::uuid[])`    : sql``}
        ${filter.stateIds?.length   ? sql`AND o.state_id   = ANY(${filter.stateIds}::uuid[])`   : sql``}
        ${filter.countryIds?.length ? sql`AND o.country_id = ANY(${filter.countryIds}::uuid[])` : sql``}
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
        ${opts.countryIds?.length ? sql`AND st.country_id = ANY(${opts.countryIds}::uuid[])` : sql``}
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
        ${opts.stateIds?.length   ? sql`AND ci.state_id   = ANY(${opts.stateIds}::uuid[])`   : sql``}
        ${opts.countryIds?.length ? sql`AND st.country_id = ANY(${opts.countryIds}::uuid[])` : sql``}
      GROUP BY ci.id, ci.name, ci.state_id, st.name, st.country_id, co.name
      ${opts.hasBranches ? sql`HAVING COUNT(o.id) > 0` : sql``}
      ORDER BY ci.name
      LIMIT 500
    `)) as Array<Record<string, unknown>>;
  });
}

export async function listUsers(tenantId: string, orgId?: string) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT u.id, u.full_name, u.email, u.org_id,
             ur.label AS role_label, u.is_active
      FROM iam.users u
      JOIN entity.organizations o ON o.id = u.org_id
      LEFT JOIN iam.user_roles ur ON ur.id = u.role_id
      WHERE o.tenant_id = ${tenantId}::uuid
        AND NOT o.is_deleted
        AND NOT u.is_deleted
        ${orgId ? sql`AND u.org_id = ${orgId}::uuid` : sql``}
      ORDER BY u.full_name
    `)) as Array<Record<string, unknown>>;
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
