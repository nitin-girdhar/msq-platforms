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

// Resolves the set of branches a /branches or /users call may read: the key's
// own binding, optionally narrowed by a caller-supplied ?branch_id csv.
// orgIds null = tenant-wide key with no narrowing (every branch of the tenant);
// an empty array = the key reaches no branch, so the caller gets no rows.
// Unlike resolveScope, a multi-branch key is fenced to its X-Allowed-Org-Ids
// even when no branch_id is sent.
async function resolveOrgScope(request: FastifyRequest): Promise<{ tenantId: string; orgIds: string[] | null }> {
  const tenantId = String(request.headers['x-tenant-id'] ?? '').trim();
  if (!tenantId || !UUID_RE.test(tenantId)) throw new UnauthorizedError('Tenant context missing');

  const q = request.query as { branch_id?: unknown };
  const requested = typeof q.branch_id === 'string' && q.branch_id
    ? q.branch_id.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (requested.some((id) => !UUID_RE.test(id))) throw new BadRequestError('branch_id must be a comma-separated list of UUIDs');

  const headerOrg = String(request.headers['x-org-id'] ?? '').trim();
  if (headerOrg) {
    if (!UUID_RE.test(headerOrg)) throw new BadRequestError('Invalid branch context');
    if (requested.some((id) => id !== headerOrg)) throw new BadRequestError('branch_id is not permitted for this API key');
    return { tenantId, orgIds: [headerOrg] };
  }

  const scopeAllOrgs = String(request.headers['x-scope-all-orgs'] ?? '') === 'true';
  if (scopeAllOrgs) {
    if (requested.length === 0) return { tenantId, orgIds: null };
    const owned = await repo.orgsBelongingToTenant(requested, tenantId);
    if (owned.length !== new Set(requested).size) throw new BadRequestError('branch_id is not permitted for this API key');
    return { tenantId, orgIds: owned };
  }

  const allowed = String(request.headers['x-allowed-org-ids'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (requested.length === 0) return { tenantId, orgIds: allowed };
  if (requested.some((id) => !allowed.includes(id))) throw new BadRequestError('branch_id is not permitted for this API key');
  return { tenantId, orgIds: [...new Set(requested)] };
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

// Strict variant for the /users filters: a malformed id is a 400, not a
// dropped filter — silently widening "users of department X" to every user in
// the tenant is the wrong failure for a caller who mistyped an id.
function parseUuidCsvStrict(value: unknown, name: string): string[] {
  if (typeof value !== 'string' || !value) return [];
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.some((s) => !UUID_RE.test(s))) throw new BadRequestError(`${name} must be a comma-separated list of UUIDs`);
  return ids;
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
    const { tenantId, orgIds } = await resolveOrgScope(request);
    const { hasBranches: _ignored, ...filter } = geoFilter(request);
    const data = await repo.listBranches(tenantId, orgIds, filter);
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
    const { tenantId, orgIds } = await resolveOrgScope(request);
    const q = request.query as Record<string, unknown>;
    const data = await repo.listUsers(tenantId, orgIds, {
      departmentIds: parseUuidCsvStrict(q['department_id'], 'department_id'),
      managerIds: parseUuidCsvStrict(q['manager_id'], 'manager_id'),
    });
    return reply.send({ success: true, data });
  };
}
