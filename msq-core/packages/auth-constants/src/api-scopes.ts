// Scopes grantable to public/partner API clients (iam.api_clients). Each key
// carries an explicit subset; a route requires exactly one scope. Least
// privilege: read and write are separate, and comms is always its own scope.

export const API_SCOPES = [
  'leads:write',
  // Single lead by id (/public/v1/leads/:id).
  'leads:read',
  // Bulk, filtered lead listing (GET /public/v1/leads). Separate from
  // leads:read so a key issued for one-at-a-time lookups never silently
  // gains the whole tenant's lead book.
  'leads:list',
  // Lookup by phone/email arrays (POST /public/v1/leads/find). Its own scope
  // because it answers "is this person already a lead?" across the key's
  // branches — a dedupe/enumeration capability a partner may not need.
  'leads:find',
  'branches:read',
  // Where a tenant operates: the country/state/city drill-down behind
  // /public/v1/locations/*. Separate from branches:read so a partner can be
  // given the presence map without the branch list.
  'locations:read',
  'users:read',
  // Read-only access to the daily lead report page (/public/v1/lead-report).
  // A key with this scope and scope_all_orgs is a tenant-wide report link; a
  // key bound to one org_id narrows the same link to a single branch.
  'lead-report:read',
  'comms:send',
  // Additive: unlocks free-form (non-template) message bodies. Granted only to
  // vetted clients. Without it, comms:send is restricted to approved templates.
  'comms:send:adhoc',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}
