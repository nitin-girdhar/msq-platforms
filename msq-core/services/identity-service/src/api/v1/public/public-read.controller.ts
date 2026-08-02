import type { FastifyRequest, FastifyReply } from 'fastify';
import { BadRequestError, UnauthorizedError } from '../../../lib/errors.js';
import * as repo from './public-read.repository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validates a caller-supplied branch against the gateway-injected scope
// headers for a multi-branch/tenant-wide key. X-Allowed-Org-Ids ids were
// already validated against the tenant when the key was created/edited, so a
// plain membership check suffices; scope_all_orgs still needs a DB check
// since the branch set isn't enumerable.
async function isBranchAllowed(request: FastifyRequest, branchId: string, tenantId: string): Promise<boolean> {
  const scopeAllOrgs = String(request.headers['x-scope-all-orgs'] ?? '') === 'true';
  if (scopeAllOrgs) return repo.orgBelongsToTenant(branchId, tenantId);
  const allowed = String(request.headers['x-allowed-org-ids'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(branchId);
}

// Resolves the tenant from the gateway-injected header (always present for a
// verified public key) and the optional branch scope.
async function resolveScope(request: FastifyRequest): Promise<{ tenantId: string; orgId?: string }> {
  const tenantId = String(request.headers['x-tenant-id'] ?? '').trim();
  if (!tenantId || !UUID_RE.test(tenantId)) throw new UnauthorizedError('Tenant context missing');

  // Key bound to exactly one branch: the gateway injects a concrete X-Org-Id
  // (already validated to belong to the tenant at key creation/edit).
  const headerOrg = String(request.headers['x-org-id'] ?? '').trim();
  if (headerOrg) {
    if (!UUID_RE.test(headerOrg)) throw new BadRequestError('Invalid branch context');
    return { tenantId, orgId: headerOrg };
  }

  // Multi-branch or tenant-wide key: caller may narrow to a branch via
  // ?branch_id, validated against the key's allowed set.
  const q = request.query as { branch_id?: string };
  if (q.branch_id) {
    if (!UUID_RE.test(q.branch_id)) throw new BadRequestError('branch_id must be a valid UUID');
    if (!(await isBranchAllowed(request, q.branch_id, tenantId))) {
      throw new BadRequestError('branch_id is not permitted for this API key');
    }
    return { tenantId, orgId: q.branch_id };
  }

  return { tenantId };
}

// Optional geo filters, shared by /branches and the three /locations routes.
// Comma-separated uuids; anything malformed is dropped rather than rejected,
// so a bad id degrades to "no filter" exactly as an absent parameter does.
// The repository interpolates the survivors into a ::uuid[] cast, so nothing
// non-UUID may get through.
function parseUuidCsv(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  return value.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s));
}

function geoFilter(request: FastifyRequest) {
  const q = request.query as Record<string, unknown>;
  return {
    cityIds: parseUuidCsv(q['city_id']),
    stateIds: parseUuidCsv(q['state_id']),
    countryIds: parseUuidCsv(q['country_id']),
    // Only places the tenant actually has an active branch in. A tenant can
    // legitimately list a state it operates in with no branch there yet.
    hasBranches: String(q['has_branches'] ?? '') === 'true',
  };
}

export class PublicReadController {
  getBranches = async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, orgId } = await resolveScope(request);
    const { hasBranches: _ignored, ...filter } = geoFilter(request);
    const data = await repo.listBranches(tenantId, orgId, filter);
    return reply.send({ success: true, data });
  };

  // ── Tenant presence drill-down ──────────────────────────────────────────
  // Every parameter is optional at every level: /states with no country_id
  // returns all of the tenant's states, /cities with only a country_id drills
  // straight past states.

  getCountries = async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, orgId } = await resolveScope(request);
    const data = await repo.listCountries(tenantId, { ...geoFilter(request), ...(orgId ? { orgId } : {}) });
    return reply.send({ success: true, data });
  };

  getStates = async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, orgId } = await resolveScope(request);
    const data = await repo.listStates(tenantId, { ...geoFilter(request), ...(orgId ? { orgId } : {}) });
    return reply.send({ success: true, data });
  };

  getCities = async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, orgId } = await resolveScope(request);
    const data = await repo.listCities(tenantId, { ...geoFilter(request), ...(orgId ? { orgId } : {}) });
    return reply.send({ success: true, data });
  };

  getUsers = async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, orgId } = await resolveScope(request);
    const data = await repo.listUsers(tenantId, orgId);
    return reply.send({ success: true, data });
  };
}
