import { toApiRows } from '@platform/db';
import * as repo from './capabilities.repository.js';
import type { PutGrantsInput } from './capabilities.schema.js';

export async function listCapabilities() {
  return toApiRows(await repo.listCapabilities());
}

export async function listRoleCapabilities(roleId: string, tenantId: string) {
  return toApiRows(await repo.listRoleCapabilities(roleId, tenantId));
}

export async function putGrants(actorUserId: string, roleId: string, data: PutGrantsInput) {
  const rows = await repo.upsertGrants({
    actorUserId,
    tenantId: data.tenant_id,
    roleId,
    grants: data.grants.map((g) => ({ capabilityId: g.capability_id, isGranted: g.is_granted })),
  });
  return toApiRows(rows.filter((r): r is NonNullable<typeof r> => r !== undefined));
}
