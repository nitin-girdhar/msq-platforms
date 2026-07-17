import { toApiRow, toApiRows } from '@crm/db';
import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './tenants.repository.js';
import * as domainsRepo from '../tenant-domains/tenant-domains.repository.js';
import * as planTypesRepo from '../tenant-plan-types/tenant-plan-types.repository.js';
import type { CreateTenantInput, UpdateTenantInput } from './tenants.schema.js';

export async function list() {
  return toApiRows(await repo.list());
}

export async function create(data: CreateTenantInput) {
  const domain = await domainsRepo.getById(data.domain_id);
  if (!domain) throw new NotFoundError('Tenant domain not found');
  const planType = await planTypesRepo.getById(data.plan_type_id);
  if (!planType) throw new NotFoundError('Tenant plan type not found');

  try {
    const row = await repo.create({
      name: data.name,
      domainId: data.domain_id,
      planTypeId: data.plan_type_id,
    });
    return toApiRow(row);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A tenant with this name already exists.');
    throw err;
  }
}

export async function update(id: string, data: UpdateTenantInput) {
  if (data.domain_id !== undefined) {
    const domain = await domainsRepo.getById(data.domain_id);
    if (!domain) throw new NotFoundError('Tenant domain not found');
  }
  if (data.plan_type_id !== undefined) {
    const planType = await planTypesRepo.getById(data.plan_type_id);
    if (!planType) throw new NotFoundError('Tenant plan type not found');
  }

  const fields: Parameters<typeof repo.update>[1] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.domain_id !== undefined) fields.domainId = data.domain_id;
  if (data.plan_type_id !== undefined) fields.planTypeId = data.plan_type_id;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(id, fields);
    if (!row) throw new NotFoundError('Tenant not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A tenant with this name already exists.');
    throw err;
  }
}
