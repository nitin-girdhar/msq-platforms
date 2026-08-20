import type { BranchOption } from './types';

interface BranchActor {
  org_id: string;
  org_name: string;
}

/**
 * The branches this actor may assign a new user to.
 *
 * Two sources, because "which branches exist" and "which branches are mine" are
 * different questions and only tenant-wide actors want the first one:
 *
 *   tenant-wide  every branch in the tenant (GET /orgs/all)
 *   everyone else the branches they hold an active iam.user_org_mapping row for
 *                 (GET /auth/my-orgs)
 *
 * The second case used to be `orgs.filter(o => o.id === actor.org_id)` — the
 * actor's CURRENT branch and nothing else. Membership is many-to-many, so that
 * silently hid the other branches of anyone who worked in more than one, and
 * switching branch was the only way to reach them.
 *
 * The actor's own branch is appended when neither source produced it. That is
 * the load-failure case: both fetches are non-fatal on the server and fall back
 * to an empty list, and the form seeds an assignment from `actor.org_id`
 * regardless — so without this the chip for that assignment has no name to
 * resolve and renders a bare UUID. Callers still surface the failure; this only
 * keeps the form legible while they do.
 */
export function branchOptionsForActor(
  orgs: BranchOption[],
  myOrgs: BranchOption[],
  actor: BranchActor,
  isTenantWide: boolean,
): BranchOption[] {
  const source = isTenantWide ? orgs : myOrgs;
  const options = source.filter((o) => o.id && o.name);

  if (actor.org_id && !options.some((o) => o.id === actor.org_id)) {
    return [{ id: actor.org_id, name: actor.org_name || 'Your branch' }, ...options];
  }
  return options;
}
