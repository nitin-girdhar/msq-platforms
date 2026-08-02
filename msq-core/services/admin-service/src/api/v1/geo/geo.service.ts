import { toApiRow, toApiRows } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './geo.repository.js';
import type {
  CreateCountryInput,
  UpdateCountryInput,
  CreateStateInput,
  UpdateStateInput,
  CreateCityInput,
  UpdateCityInput,
} from './geo.schema.js';

// A unique violation here means the tenant already has a place with that name
// under the same parent — see the partial unique index pairs in
// db_scripts/06_indexes.sql.
function rethrowAsConflict(err: unknown, message: string): never {
  const msg = (err as Error).message ?? '';
  if (msg.includes('unique') || msg.includes('duplicate key')) throw new ConflictError(message);
  throw err;
}

// ── Countries ───────────────────────────────────────────────────────────────

export async function listCountries(tenantId: string) {
  return toApiRows(await repo.listCountries(tenantId));
}

export async function createCountry(tenantId: string, data: CreateCountryInput) {
  try {
    const row = await repo.createCountry({
      tenantId,
      name: data.name,
      isoCode: data.iso_code,
      ...(data.description !== undefined ? { description: data.description } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    rethrowAsConflict(err, 'A country with this name or ISO code already exists for this tenant.');
  }
}

export async function updateCountry(id: string, tenantId: string, data: UpdateCountryInput) {
  const fields: Parameters<typeof repo.updateCountry>[2] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.iso_code !== undefined) fields.isoCode = data.iso_code;
  if (data.description !== undefined) fields.description = data.description;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.updateCountry(id, tenantId, fields);
    if (!row) throw new NotFoundError('Country not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    rethrowAsConflict(err, 'A country with this name or ISO code already exists for this tenant.');
  }
}

// ── States ──────────────────────────────────────────────────────────────────

export async function listStates(tenantId: string) {
  return toApiRows(await repo.listStates(tenantId));
}

export async function createState(tenantId: string, data: CreateStateInput) {
  if (!(await repo.countryBelongsToTenant(data.country_id, tenantId))) {
    throw new BadRequestError('country_id does not belong to this tenant.');
  }
  try {
    const row = await repo.createState({
      tenantId,
      countryId: data.country_id,
      name: data.name,
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    rethrowAsConflict(err, 'A state with this name already exists in that country.');
  }
}

export async function updateState(id: string, tenantId: string, data: UpdateStateInput) {
  if (data.country_id !== undefined && !(await repo.countryBelongsToTenant(data.country_id, tenantId))) {
    throw new BadRequestError('country_id does not belong to this tenant.');
  }
  const fields: Parameters<typeof repo.updateState>[2] = {};
  if (data.country_id !== undefined) fields.countryId = data.country_id;
  if (data.name !== undefined) fields.name = data.name;
  if (data.code !== undefined) fields.code = data.code;
  if (data.description !== undefined) fields.description = data.description;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.updateState(id, tenantId, fields);
    if (!row) throw new NotFoundError('State not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    rethrowAsConflict(err, 'A state with this name already exists in that country.');
  }
}

// ── Cities ──────────────────────────────────────────────────────────────────

export async function listCities(tenantId: string) {
  return toApiRows(await repo.listCities(tenantId));
}

export async function createCity(tenantId: string, data: CreateCityInput) {
  if (!(await repo.stateBelongsToTenant(data.state_id, tenantId))) {
    throw new BadRequestError('state_id does not belong to this tenant.');
  }
  try {
    const row = await repo.createCity({
      tenantId,
      stateId: data.state_id,
      name: data.name,
      ...(data.description !== undefined ? { description: data.description } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    rethrowAsConflict(err, 'A city with this name already exists in that state.');
  }
}

export async function updateCity(id: string, tenantId: string, data: UpdateCityInput) {
  if (data.state_id !== undefined && !(await repo.stateBelongsToTenant(data.state_id, tenantId))) {
    throw new BadRequestError('state_id does not belong to this tenant.');
  }
  const fields: Parameters<typeof repo.updateCity>[2] = {};
  if (data.state_id !== undefined) fields.stateId = data.state_id;
  if (data.name !== undefined) fields.name = data.name;
  if (data.description !== undefined) fields.description = data.description;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.updateCity(id, tenantId, fields);
    if (!row) throw new NotFoundError('City not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    rethrowAsConflict(err, 'A city with this name already exists in that state.');
  }
}
