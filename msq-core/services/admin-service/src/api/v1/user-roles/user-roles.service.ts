import { toApiRow, toApiRows } from '@platform/db';
import {
  RESERVED_ROLE_RANK,
  GLOBAL_ONLY_ROLE,
  DYNAMIC_RANK_MIN,
  DYNAMIC_RANK_MAX,
} from '@platform/rbac';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './user-roles.repository.js';
import type { CreateUserRoleInput, UpdateUserRoleInput } from './user-roles.schema.js';

export async function list(tenantId: string) {
  return toApiRows(await repo.list(tenantId));
}

/**
 * The authoritative rank rule. The admin UI also locks the field for reserved
 * names, but that is convenience — this runs on every write, including a raw
 * PATCH that never touched the form.
 *
 *  - `super_admin` may not be created or renamed to at all: it is the one global
 *    role (_migrations/23) and handing it out from a tenant-scoped screen would
 *    grant platform-wide authority by accident.
 *  - A reserved name (read_only / org_admin / tenant_admin) carries a fixed rank.
 *    platform_role derivation and PG-role selection resolve off these, so an
 *    operator-chosen value would quietly break authorization.
 *  - Everything else must sit in the tenant band.
 */
function assertRank(name: string | undefined, rank: number | undefined): void {
  if (name === GLOBAL_ONLY_ROLE) {
    throw new BadRequestError(`'${GLOBAL_ONLY_ROLE}' is a platform-wide role and cannot be managed here.`);
  }

  const reserved = name !== undefined ? RESERVED_ROLE_RANK[name] : undefined;
  if (reserved !== undefined) {
    if (rank !== undefined && rank !== reserved) {
      throw new BadRequestError(`'${name}' has a fixed rank of ${reserved} and cannot be re-ranked.`);
    }
    return;
  }

  if (rank !== undefined && (rank < DYNAMIC_RANK_MIN || rank > DYNAMIC_RANK_MAX)) {
    throw new BadRequestError(
      `Rank must be between ${DYNAMIC_RANK_MIN} and ${DYNAMIC_RANK_MAX}.`,
    );
  }
}

// A unique violation here has two very different causes, and reporting both as
// a name clash sent admins hunting for a duplicate name that did not exist.
//   uix_user_roles_tenant_name      -> (tenant_id, name)
//   uix_user_roles_tenant_dept_rank -> (tenant_id, department_id, rank)
function asConflict(err: unknown): Error {
  const msg = (err as Error).message ?? '';
  if (!msg.includes('unique') && !msg.includes('duplicate key')) return err as Error;
  if (msg.includes('rank')) {
    return new ConflictError('Another role in this department already uses that rank.');
  }
  return new ConflictError('A user role with this name already exists for this tenant.');
}

export async function create(tenantId: string, data: CreateUserRoleInput) {
  assertRank(data.name, data.rank);

  // A reserved name always stores its fixed rank, whatever arrived on the wire.
  const rank = RESERVED_ROLE_RANK[data.name] ?? data.rank;

  try {
    const row = await repo.create({
      tenantId,
      departmentId: data.department_id,
      name: data.name,
      label: data.label,
      rank,
      ...(data.description !== undefined ? { description: data.description } : {}),
    });
    return toApiRow(row);
  } catch (err) {
    throw asConflict(err);
  }
}

export async function update(id: string, data: UpdateUserRoleInput) {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('User role not found');

  // Rank is validated against the name the row will HAVE after this patch, so
  // renaming a role into a reserved name cannot smuggle an arbitrary rank in.
  const nextName = data.name ?? existing.name;
  assertRank(nextName, data.rank);

  const fields: Parameters<typeof repo.update>[1] = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.label !== undefined) fields.label = data.label;
  if (data.description !== undefined) fields.description = data.description;
  if (data.rank !== undefined) fields.rank = data.rank;
  if (data.is_active !== undefined) fields.isActive = data.is_active;
  if (data.department_id !== undefined) fields.departmentId = data.department_id;

  // Re-assert the fixed rank when a row becomes reserved by rename.
  const reserved = RESERVED_ROLE_RANK[nextName];
  if (reserved !== undefined) fields.rank = reserved;

  try {
    const row = await repo.update(id, fields);
    if (!row) throw new NotFoundError('User role not found');
    return toApiRow(row);
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    throw asConflict(err);
  }
}
