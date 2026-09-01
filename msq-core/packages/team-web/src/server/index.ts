// Server-only half of @platform/team-web. Behind the `./server` subpath export
// for the same reason @platform/ui-kit splits its own: this reaches the gateway
// with the request's cookies and must never be pulled into a client bundle.
// Never import it from a 'use client' module.
import { GATEWAY_URL } from '@platform/ui-kit/server';
import type { OrgMembership, SessionUser } from '@platform/types';
import type { TeamRow, TeamScope } from '../lib/types';

export type { TeamRow, TeamScope };

export interface OrgOption {
  id: string;
  name: string;
}

export type TeamPageData =
  | { ok: false; status: number }
  | {
      ok: true;
      users: TeamRow[];
      total: number;
      orgs: OrgOption[];
      myOrgs: OrgOption[];
      branchesFailed: boolean;
      /** What the server ACTUALLY ran, which may be narrower than requested. */
      scope: TeamScope;
    };

/**
 * Everything the Team screen renders, fetched server-side so the roster arrives
 * with the document rather than after a client round-trip.
 *
 * Lives in the package rather than in each host's page.tsx: the three calls, the
 * row normalisation and the partial-failure rules are the screen's business, and
 * duplicating them per host is exactly how admin-web's Team and lms-web's Users
 * drifted apart in the first place. A host supplies the cookie header and
 * decides what to render on `ok: false`.
 */
export async function loadTeamData(cookieHeader: string, scope?: TeamScope): Promise<TeamPageData> {
  // No org_id param: identity-service scopes /users to the caller's own
  // org/tenant from the gateway-verified session, and picks the roster slice
  // from the actor's admin.team.view.* rung (see users.service.ts listUsers).
  // page_size=500 is the schema's max (users.schema.ts) — the grid does its own
  // client-side paging/sorting/filtering, so the whole roster comes in one
  // request rather than driving page/page_size from the UI.
  // Two branch lists: /orgs/all is every branch in the tenant (assignable only
  // by a tenant-wide actor), /auth/my-orgs is this actor's own mapping rows —
  // the branches a multi-branch admin may actually place someone into.
  const [res, orgsRes, myOrgsRes] = await Promise.all([
    fetch(`${GATEWAY_URL}/users?page_size=500${scope ? `&scope=${scope}` : ''}`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
    fetch(`${GATEWAY_URL}/orgs/all`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
    fetch(`${GATEWAY_URL}/auth/my-orgs`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
  ]);

  // Only the roster is fatal. A branch fetch failing degrades the form rather
  // than the page — but not silently; see branchesFailed below.
  if (!res.ok) {
    console.error(`[team] GET ${GATEWAY_URL}/users failed: ${res.status} ${res.statusText}`);
    return { ok: false, status: res.status };
  }

  let orgs: OrgOption[] = [];
  if (orgsRes.ok) {
    const orgsData = await orgsRes.json() as { data?: Array<{ id: string; name: string }> };
    orgs = Array.isArray(orgsData.data) ? orgsData.data.map((o) => ({ id: o.id, name: o.name })) : [];
  } else {
    console.error(`[team] GET ${GATEWAY_URL}/orgs/all failed: ${orgsRes.status} ${orgsRes.statusText}`);
  }

  let myOrgs: OrgOption[] = [];
  if (myOrgsRes.ok) {
    const myOrgsData = await myOrgsRes.json() as { data?: { orgs?: Array<{ org_id: string; org_name: string }> } };
    const rawOrgs = Array.isArray(myOrgsData.data?.orgs) ? myOrgsData.data.orgs : [];
    myOrgs = rawOrgs.map((o) => ({ id: o.org_id, name: o.org_name }));
  } else {
    console.error(`[team] GET ${GATEWAY_URL}/auth/my-orgs failed: ${myOrgsRes.status} ${myOrgsRes.statusText}`);
  }

  // Not fatal, but no longer silent: the form says so instead of quietly
  // offering a single nameless branch.
  const branchesFailed = !orgsRes.ok || !myOrgsRes.ok;

  const body = await res.json() as { data?: Record<string, unknown>[]; total?: number; scope?: TeamScope };
  const raw = Array.isArray(body.data) ? body.data : [];
  const total = typeof body.total === 'number' ? body.total : raw.length;
  const users: TeamRow[] = raw.map((u) => ({
    ...u,
    name: (u.full_name ?? u.name ?? '') as string,
    role: (u.role_name ?? u.role ?? '') as SessionUser['role'],
    role_label: (u.role_label ?? '') as string,
    rank: Number(u.rank ?? 0),
    org_id: (u.org_id ?? '') as string,
    org_name: (u.org_name ?? '') as string,
    // Every branch this user is mapped into (identity-service aggregates them
    // in listUsers), not just the home branch org_id/org_name name. Defaulted
    // to [] so the table can fall back to the home branch for a row that
    // predates the field.
    org_memberships: (Array.isArray(u.org_memberships) ? u.org_memberships : []) as OrgMembership[],
    tenant_id: (u.tenant_id ?? '') as string,
    tenant_name: (u.tenant_name ?? '') as string,
    manager_name: (u.manager_name ?? null) as string | null,
    // Only present under the `reports` scope; null elsewhere, where the roster
    // is not a subtree and a depth would be a fiction.
    report_depth: u.report_depth === null || u.report_depth === undefined
      ? null
      : Number(u.report_depth),
  })) as TeamRow[];

  // The server's answer, not the request: it silently narrows a scope the actor
  // may not use, and the switcher has to show which roster is really on screen.
  return { ok: true, users, total, orgs, myOrgs, branchesFailed, scope: body.scope ?? 'org' };
}
