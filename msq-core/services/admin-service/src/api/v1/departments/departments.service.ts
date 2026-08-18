import { toApiRow, toApiRows } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './departments.repository.js';
import type { CreateDepartmentInput, UpdateDepartmentInput } from './departments.schema.js';

export async function list(tenantId: string) {
  return toApiRows(await repo.list(tenantId));
}

// An org_id from a different tenant would produce a department that shows up
// under one tenant while pointing at another's branch. The FK alone does not
// catch it (it only requires the org to exist) and withServiceTx bypasses the
// RLS that otherwise would, so the check is explicit.
async function assertOrgInTenant(orgId: string | null | undefined, tenantId: string): Promise<void> {
  if (!orgId) return;
  if (!(await repo.orgBelongsToTenant(orgId, tenantId))) {
    throw new BadRequestError('That organization does not belong to this tenant.');
  }
}

function asConflict(err: unknown): Error {
  const msg = (err as Error).message ?? '';
  if (msg.includes('unique') || msg.includes('duplicate key')) {
    return new ConflictError('A department with this name already exists for this tenant.');
  }
  return err as Error;
}

export async function create(tenantId: string, data: CreateDepartmentInput) {
  await assertOrgInTenant(data.org_id, tenantId);

  try {
    const row = await repo.create({
      tenantId,
      name: data.name,
      label: data.label,
      // Absent and explicit-null both mean tenant-wide.
      orgId: data.org_id ?? null,
      ...(data.description !== undefined ? { description: data.description } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    throw asConflict(err);
  }
}

export async function update(tenantId: string, id: string, data: UpdateDepartmentInput) {
  const existing = await repo.findById(id);
  // Scoped by tenant as well as id: without it a super_admin with tenant A
  // selected could patch tenant B's department by guessing its id.
  if (!existing || existing.tenantId !== tenantId || existing.isDeleted) {
    throw new NotFoundError('Department not found');
  }

  await assertOrgInTenant(data.org_id, tenantId);

  const fields: Parameters<typeof repo.update>[1] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.label !== undefined) fields.label = data.label;
  if (data.description !== undefined) fields.description = data.description;
  if (data.org_id !== undefined) fields.orgId = data.org_id ?? null;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(id, fields);
    if (!row) throw new NotFoundError('Department not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    throw asConflict(err);
  }
}
