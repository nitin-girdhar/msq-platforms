import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import {
  organizationsTable,
  tenantsTable,
  orgTypesTable,
  citiesTable,
  statesTable,
  countriesTable,
} from '@crm/db/schema';

type OrganizationInsert = typeof organizationsTable.$inferInsert;
type OrganizationUpdate = Partial<OrganizationInsert>;

// Resolved projection: raw FK ids are kept for edit-form pre-fill, and each
// referenced lookup table's human-readable label/name is joined in alongside
// so the frontend never has to resolve an id itself.
export async function list() {
  return withServiceTx((tx) =>
    tx
      .select({
        id: organizationsTable.id,
        tenantId: organizationsTable.tenantId,
        name: organizationsTable.name,
        legalEntityName: organizationsTable.legalEntityName,
        brandName: organizationsTable.brandName,
        orgTypeId: organizationsTable.orgTypeId,
        addressLine1: organizationsTable.addressLine1,
        addressLine2: organizationsTable.addressLine2,
        landmark: organizationsTable.landmark,
        pincode: organizationsTable.pincode,
        cityId: organizationsTable.cityId,
        stateId: organizationsTable.stateId,
        countryId: organizationsTable.countryId,
        timezone: organizationsTable.timezone,
        isActive: organizationsTable.isActive,
        isDeleted: organizationsTable.isDeleted,
        metadata: organizationsTable.metadata,
        createdAt: organizationsTable.createdAt,
        updatedAt: organizationsTable.updatedAt,
        tenantName: tenantsTable.name,
        orgTypeLabel: orgTypesTable.label,
        cityName: citiesTable.name,
        stateName: statesTable.name,
        countryName: countriesTable.name,
      })
      .from(organizationsTable)
      .leftJoin(tenantsTable, eq(organizationsTable.tenantId, tenantsTable.id))
      .leftJoin(orgTypesTable, eq(organizationsTable.orgTypeId, orgTypesTable.id))
      .leftJoin(citiesTable, eq(organizationsTable.cityId, citiesTable.id))
      .leftJoin(statesTable, eq(organizationsTable.stateId, statesTable.id))
      .leftJoin(countriesTable, eq(organizationsTable.countryId, countriesTable.id))
      .orderBy(asc(organizationsTable.name)),
  );
}

export async function create(fields: OrganizationInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(organizationsTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: OrganizationUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(organizationsTable).set(fields).where(eq(organizationsTable.id, id)).returning();
    return row ?? null;
  });
}

export async function getById(id: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
    return row ?? null;
  });
}
