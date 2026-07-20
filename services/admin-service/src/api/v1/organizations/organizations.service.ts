import { toApiRow, toApiRows } from '@platform/db';
import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './organizations.repository.js';
import * as tenantsRepo from '../tenants/tenants.repository.js';
import * as orgTypesRepo from '../org-types/org-types.repository.js';
import type { CreateOrganizationInput, UpdateOrganizationInput } from './organizations.schema.js';

export async function list() {
  return toApiRows(await repo.list());
}

export async function create(data: CreateOrganizationInput) {
  const tenant = await tenantsRepo.getById(data.tenant_id);
  if (!tenant) throw new NotFoundError('Tenant not found');
  const orgType = await orgTypesRepo.getById(data.org_type_id);
  if (!orgType) throw new NotFoundError('Org type not found');

  try {
    const row = await repo.create({
      tenantId: data.tenant_id,
      name: data.name,
      orgTypeId: data.org_type_id,
      ...(data.legal_entity_name !== undefined ? { legalEntityName: data.legal_entity_name } : {}),
      ...(data.brand_name !== undefined ? { brandName: data.brand_name } : {}),
      ...(data.address_line1 !== undefined ? { addressLine1: data.address_line1 } : {}),
      ...(data.address_line2 !== undefined ? { addressLine2: data.address_line2 } : {}),
      ...(data.landmark !== undefined ? { landmark: data.landmark } : {}),
      ...(data.pincode !== undefined ? { pincode: data.pincode } : {}),
      ...(data.city_id !== undefined ? { cityId: data.city_id } : {}),
      ...(data.state_id !== undefined ? { stateId: data.state_id } : {}),
      ...(data.country_id !== undefined ? { countryId: data.country_id } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('An organization with this name already exists for this tenant.');
    throw err;
  }
}

export async function update(id: string, data: UpdateOrganizationInput) {
  if (data.tenant_id !== undefined) {
    const tenant = await tenantsRepo.getById(data.tenant_id);
    if (!tenant) throw new NotFoundError('Tenant not found');
  }
  if (data.org_type_id !== undefined) {
    const orgType = await orgTypesRepo.getById(data.org_type_id);
    if (!orgType) throw new NotFoundError('Org type not found');
  }

  const fields: Parameters<typeof repo.update>[1] = {};
  if (data.tenant_id !== undefined) fields.tenantId = data.tenant_id;
  if (data.name !== undefined) fields.name = data.name;
  if (data.legal_entity_name !== undefined) fields.legalEntityName = data.legal_entity_name;
  if (data.brand_name !== undefined) fields.brandName = data.brand_name;
  if (data.org_type_id !== undefined) fields.orgTypeId = data.org_type_id;
  if (data.address_line1 !== undefined) fields.addressLine1 = data.address_line1;
  if (data.address_line2 !== undefined) fields.addressLine2 = data.address_line2;
  if (data.landmark !== undefined) fields.landmark = data.landmark;
  if (data.pincode !== undefined) fields.pincode = data.pincode;
  if (data.city_id !== undefined) fields.cityId = data.city_id;
  if (data.state_id !== undefined) fields.stateId = data.state_id;
  if (data.country_id !== undefined) fields.countryId = data.country_id;
  if (data.timezone !== undefined) fields.timezone = data.timezone;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(id, fields);
    if (!row) throw new NotFoundError('Organization not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('An organization with this name already exists for this tenant.');
    throw err;
  }
}
