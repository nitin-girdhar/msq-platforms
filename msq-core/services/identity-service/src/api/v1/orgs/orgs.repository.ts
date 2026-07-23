import { sql, asc } from 'drizzle-orm';
import { withRoleTx, withServiceTx } from '@platform/db';
import type { RoleTxContext } from '@platform/db';
import { leadSourcesTable } from '@platform/db/schema';

export interface LocationFilter {
  cityIds?:    number[];
  stateIds?:   number[];
  countryIds?: number[];
}

export async function getOrgs(ctx: RoleTxContext, filter: LocationFilter) {
  const isTenantWide = ctx.role === 'tenant_admin' || ctx.role === 'super_admin';
  return withRoleTx(ctx, async (tx) => {
    const scopeClause = isTenantWide
      ? sql`o.tenant_id = (SELECT tenant_id FROM entity.organizations WHERE id = ${ctx.org_id}::uuid)`
      : sql`o.id = ${ctx.org_id}::uuid`;

    let locationClause = sql``;
    if (filter.cityIds?.length) {
      locationClause = sql`AND o.city_id = ANY(${filter.cityIds}::int[])`;
    } else if (filter.stateIds?.length) {
      locationClause = sql`AND o.state_id = ANY(${filter.stateIds}::smallint[])`;
    } else if (filter.countryIds?.length) {
      locationClause = sql`AND o.country_id = ANY(${filter.countryIds}::smallint[])`;
    }

    return (await tx.execute(sql`
      SELECT o.id, o.name,
             o.city_id    AS "cityId",
             o.state_id   AS "stateId",
             o.country_id AS "countryId",
             o.timezone   AS "timezone",
             o.geo_lat::float8 AS "geoLat",
             o.geo_lng::float8 AS "geoLng"
      FROM entity.organizations o
      WHERE ${scopeClause} AND NOT o.is_deleted AND o.is_active
        ${locationClause}
      ORDER BY o.name
    `)) as Array<Record<string, unknown>>;
  });
}

// Minimal org update: set the attendance geofence centre. Scoped to the caller's
// tenant (the org must belong to it). Authorization (rank >= RANKS.ORG_ADMIN,
// 980) is enforced in
// the service layer; the write runs via the service pool.
export async function updateOrgGeo(
  ctx: Pick<RoleTxContext, 'org_id' | 'tenant_id'>,
  orgId: string,
  geo: { geo_lat?: number | null | undefined; geo_lng?: number | null | undefined },
): Promise<{ id: string; geoLat: number | null; geoLng: number | null } | null> {
  return withServiceTx(async (tx) => {
    const sets: ReturnType<typeof sql>[] = [];
    if (geo.geo_lat !== undefined) sets.push(sql`geo_lat = ${geo.geo_lat}`);
    if (geo.geo_lng !== undefined) sets.push(sql`geo_lng = ${geo.geo_lng}`);
    if (sets.length === 0) return null;
    const rows = (await tx.execute(sql`
      UPDATE entity.organizations
      SET ${sql.join(sets, sql`, `)}, updated_at = NOW()
      WHERE id = ${orgId}::uuid
        AND tenant_id = (SELECT tenant_id FROM entity.organizations WHERE id = ${ctx.org_id}::uuid)
        AND NOT is_deleted
      RETURNING id, geo_lat::float8 AS "geoLat", geo_lng::float8 AS "geoLng"
    `)) as Array<{ id: string; geoLat: number | null; geoLng: number | null }>;
    return rows[0] ?? null;
  });
}

export async function getAllOrgs(ctx: Pick<RoleTxContext, 'org_id'>) {
  return withServiceTx(async (tx) => {
    return (await tx.execute(sql`
      SELECT o.id, o.name
      FROM entity.organizations o
      WHERE o.tenant_id = (
        SELECT tenant_id FROM entity.organizations WHERE id = ${ctx.org_id}::uuid
      )
      AND NOT o.is_deleted AND o.is_active
      ORDER BY o.name
    `)) as Array<{ id: string; name: string }>;
  });
}

export async function getLeadSources() {
  return withServiceTx(async (tx) => {
    return tx
      .select({ id: leadSourcesTable.id, name: leadSourcesTable.name })
      .from(leadSourcesTable)
      .orderBy(asc(leadSourcesTable.name));
  });
}
