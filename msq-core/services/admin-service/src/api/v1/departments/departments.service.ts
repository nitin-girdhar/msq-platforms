import { toApiRows } from '@platform/db';
import * as repo from './departments.repository.js';

export async function list(tenantId: string) {
  return toApiRows(await repo.list(tenantId));
}
