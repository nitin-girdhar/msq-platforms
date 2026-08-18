import { toApiRow, toApiRows } from '@platform/db';
import { BadRequestError, ConflictError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './capi-event-types.repository.js';
import type { CreateCapiEventTypeInput, UpdateCapiEventTypeInput } from './capi-event-types.schema.js';

// The console's shared grid (LookupTable.tsx) always renders a synthetic
// `name` column and resolves fk labels from `<field>_name`; ext.meta_capi_event_types
// has no name column, only `code`. Aliasing it here means the frontend needs
// no special case for this one table's shape.
function withNameAlias<T extends Record<string, unknown> | null | undefined>(row: T): T {
  if (!row) return row;
  return { ...row, name: row['code'] } as T;
}

// The console's PATCH route carries `:id` as a path segment, always a string —
// every other lookup table's id is a UUID that passes straight through, but
// this one is a SMALLINT identity column. Parsed once at the boundary so a
// malformed id 400s instead of the query silently matching zero rows.
function parseId(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n)) throw new BadRequestError('Invalid id.');
  return n;
}

export async function list() {
  return toApiRows(await repo.list()).map(withNameAlias);
}

export async function create(data: CreateCapiEventTypeInput) {
  try {
    const row = await repo.create({
      code: data.code,
      label: data.label,
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.sort_order !== undefined ? { sortOrder: data.sort_order } : {}),
    });
    return withNameAlias(toApiRow(row));
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A CAPI event type with this code already exists.');
    throw err;
  }
}

export async function update(idParam: string, data: UpdateCapiEventTypeInput) {
  const id = parseId(idParam);

  const fields: Parameters<typeof repo.update>[1] = {};
  if (data.code !== undefined) fields.code = data.code;
  if (data.label !== undefined) fields.label = data.label;
  if (data.description !== undefined) fields.description = data.description;
  if (data.sort_order !== undefined) fields.sortOrder = data.sort_order;
  if (data.is_active !== undefined) fields.isActive = data.is_active;

  try {
    const row = await repo.update(id, fields);
    if (!row) throw new NotFoundError('CAPI event type not found');
    return withNameAlias(toApiRow(row));
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique')) throw new ConflictError('A CAPI event type with this code already exists.');
    throw err;
  }
}
