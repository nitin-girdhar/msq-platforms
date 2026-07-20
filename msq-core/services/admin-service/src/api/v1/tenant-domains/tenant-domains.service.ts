import { toApiRow, toApiRows } from '@platform/db';
import { ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './tenant-domains.repository.js';
import type { CreateTenantDomainInput, UpdateTenantDomainInput } from './tenant-domains.schema.js';

export async function list() {
  return toApiRows(await repo.list());
}

export async function create(data: CreateTenantDomainInput) {
  try {
    const row = await repo.create({
      name: data.name,
      label: data.label,
      ...(data.description !== undefined ? { description: data.description } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A tenant domain with this name already exists.');
    throw err;
  }
}

export async function update(id: string, data: UpdateTenantDomainInput) {
  const fields: Parameters<typeof repo.update>[1] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.label !== undefined) fields.label = data.label;
  if (data.description !== undefined) fields.description = data.description;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(id, fields);
    if (!row) throw new NotFoundError('Tenant domain not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A tenant domain with this name already exists.');
    throw err;
  }
}
