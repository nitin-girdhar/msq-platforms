// Scopes grantable to public/partner API clients (ext.api_clients). Each key
// carries an explicit subset; a route requires exactly one scope. Least
// privilege: read and write are separate, and comms is always its own scope.

export const API_SCOPES = [
  'leads:write',
  'branches:read',
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
