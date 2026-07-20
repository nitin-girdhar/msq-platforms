import type { RoleTxContext } from '@platform/db';
import { ForbiddenError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './orgs.repository.js';
import type { LocationFilter } from './orgs.repository.js';
import type { UpdateOrgGeoInput } from './orgs.schema.js';

export async function getOrgs(ctx: RoleTxContext, filter: LocationFilter) {
  return repo.getOrgs(ctx, filter);
}

// Org geofence-centre update — org_admin+ (rank >= 80) only.
export async function updateOrgGeo(ctx: RoleTxContext & { rank: number }, orgId: string, data: UpdateOrgGeoInput) {
  if (ctx.rank < 80) {
    throw new ForbiddenError('Only org admins (or above) can update the organization location');
  }
  const updated = await repo.updateOrgGeo(ctx, orgId, data);
  if (!updated) throw new NotFoundError('Organization not found in your tenant');
  return updated;
}

export async function getAllOrgs(ctx: RoleTxContext) {
  return repo.getAllOrgs(ctx);
}

export async function getLeadSources() {
  return repo.getLeadSources();
}
