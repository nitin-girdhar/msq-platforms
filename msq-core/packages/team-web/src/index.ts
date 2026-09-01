// @platform/team-web — the Team screen: the people directory and org chart,
// scoped to whatever slice of the roster the actor's admin.team.view.* rung
// allows. Mounted today in admin-web; the module exists so a second host (LMS,
// or another product console) is a workspace dep, a transpilePackages entry and
// a thin page.tsx rather than a second copy that drifts.
//
// Public surface: the page-level Shell a host renders, the capability
// predicates its page.tsx evaluates first, and the server loader that fills it.
// Everything else — the table, the modals, the api client — is internal.
//
// The server half lives behind the `./server` subpath (see src/server/index.ts)
// so a client bundle can never pull the gateway fetch in.

export { default as TeamShell } from './components/team/TeamShell';

export { canOpenTeam, canManageTeam, canCreateUser } from './lib/permissions';

export type { AssignableUser } from './lib/api';
