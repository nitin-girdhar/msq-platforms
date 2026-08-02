import { asc, eq, and } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { countriesTable, statesTable, citiesTable } from '@platform/db/schema';

type CountryInsert = typeof countriesTable.$inferInsert;
type StateInsert = typeof statesTable.$inferInsert;
type CityInsert = typeof citiesTable.$inferInsert;

// geo.* is tenant-scoped (db_scripts/08_rls.sql), and withServiceTx bypasses
// RLS — so the tenant filter below is not an optimisation, it is the isolation.
// Every query here takes tenantId and every one uses it, matching
// user-roles.repository.ts. A missing filter would flatten every tenant's
// geography into one list, and every tenant has a row called "Gurgaon".
//
// The parent joins are qualified on tenant_id as well as id even though the
// composite FKs already make a cross-tenant parent impossible. The redundancy
// is free and survives a future refactor that drops the FK.

// ── Countries ───────────────────────────────────────────────────────────────

export async function listCountries(tenantId: string) {
  return withServiceTx((tx) =>
    tx
      .select({
        id: countriesTable.id,
        tenant_id: countriesTable.tenantId,
        name: countriesTable.name,
        iso_code: countriesTable.isoCode,
        description: countriesTable.description,
        is_active: countriesTable.isActive,
      })
      .from(countriesTable)
      .where(eq(countriesTable.tenantId, tenantId))
      .orderBy(asc(countriesTable.name)),
  );
}

export async function createCountry(fields: CountryInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(countriesTable).values(fields).returning();
    return row;
  });
}

export async function updateCountry(id: string, tenantId: string, fields: Partial<CountryInsert>) {
  return withServiceTx(async (tx) => {
    const [row] = await tx
      .update(countriesTable)
      .set(fields)
      .where(and(eq(countriesTable.id, id), eq(countriesTable.tenantId, tenantId)))
      .returning();
    return row ?? null;
  });
}

// ── States ──────────────────────────────────────────────────────────────────

export async function listStates(tenantId: string) {
  return withServiceTx((tx) =>
    tx
      .select({
        id: statesTable.id,
        tenant_id: statesTable.tenantId,
        country_id: statesTable.countryId,
        // The admin grid renders an fk column from "<relation>_name", falling
        // back to the raw id — without this join the Country column would read
        // as a bare UUID.
        country_name: countriesTable.name,
        name: statesTable.name,
        code: statesTable.code,
        description: statesTable.description,
        is_active: statesTable.isActive,
      })
      .from(statesTable)
      .leftJoin(
        countriesTable,
        and(eq(countriesTable.id, statesTable.countryId), eq(countriesTable.tenantId, statesTable.tenantId)),
      )
      .where(eq(statesTable.tenantId, tenantId))
      .orderBy(asc(statesTable.name)),
  );
}

export async function createState(fields: StateInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(statesTable).values(fields).returning();
    return row;
  });
}

export async function updateState(id: string, tenantId: string, fields: Partial<StateInsert>) {
  return withServiceTx(async (tx) => {
    const [row] = await tx
      .update(statesTable)
      .set(fields)
      .where(and(eq(statesTable.id, id), eq(statesTable.tenantId, tenantId)))
      .returning();
    return row ?? null;
  });
}

// ── Cities ──────────────────────────────────────────────────────────────────

export async function listCities(tenantId: string) {
  return withServiceTx((tx) =>
    tx
      .select({
        id: citiesTable.id,
        tenant_id: citiesTable.tenantId,
        state_id: citiesTable.stateId,
        state_name: statesTable.name,
        name: citiesTable.name,
        description: citiesTable.description,
        is_active: citiesTable.isActive,
      })
      .from(citiesTable)
      .leftJoin(
        statesTable,
        and(eq(statesTable.id, citiesTable.stateId), eq(statesTable.tenantId, citiesTable.tenantId)),
      )
      .where(eq(citiesTable.tenantId, tenantId))
      .orderBy(asc(citiesTable.name)),
  );
}

export async function createCity(fields: CityInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(citiesTable).values(fields).returning();
    return row;
  });
}

export async function updateCity(id: string, tenantId: string, fields: Partial<CityInsert>) {
  return withServiceTx(async (tx) => {
    const [row] = await tx
      .update(citiesTable)
      .set(fields)
      .where(and(eq(citiesTable.id, id), eq(citiesTable.tenantId, tenantId)))
      .returning();
    return row ?? null;
  });
}

// ── Parent ownership checks ─────────────────────────────────────────────────
// The composite FK would reject a cross-tenant parent anyway, but as a raw
// 23503 with a constraint name in it. Checking first turns that into a 400
// that names the field.

export async function countryBelongsToTenant(countryId: string, tenantId: string): Promise<boolean> {
  return withServiceTx(async (tx) => {
    const rows = await tx
      .select({ id: countriesTable.id })
      .from(countriesTable)
      .where(and(eq(countriesTable.id, countryId), eq(countriesTable.tenantId, tenantId)))
      .limit(1);
    return rows.length > 0;
  });
}

export async function stateBelongsToTenant(stateId: string, tenantId: string): Promise<boolean> {
  return withServiceTx(async (tx) => {
    const rows = await tx
      .select({ id: statesTable.id })
      .from(statesTable)
      .where(and(eq(statesTable.id, stateId), eq(statesTable.tenantId, tenantId)))
      .limit(1);
    return rows.length > 0;
  });
}
