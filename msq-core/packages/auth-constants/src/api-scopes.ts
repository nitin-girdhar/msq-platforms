// Scopes grantable to public/partner API clients (iam.api_clients). Each key
// carries an explicit subset; a route requires exactly one scope. Least
// privilege: read and write are separate, and comms is always its own scope.

export const API_SCOPES = [
  'leads:write',
  'branches:read',
  // Where a tenant operates: the country/state/city drill-down behind
  // /public/v1/locations/*. Separate from branches:read so a partner can be
  // given the presence map without the branch list.
  'locations:read',
  'users:read',
  'comms:send',
  // Additive: unlocks free-form (non-template) message bodies. Granted only to
  // vetted clients. Without it, comms:send is restricted to approved templates.
  'comms:send:adhoc',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}
