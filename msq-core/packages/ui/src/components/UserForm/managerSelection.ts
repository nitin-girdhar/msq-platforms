import type { ManagerCandidate } from './types';

interface ClearInput {
  /** The selected manager id ('' = none). */
  value: string;
  /** The home branch the form is currently pointed at. */
  homeOrgId: string;
  /** The home branch the form opened with. */
  initialHomeOrgId: string;
  /** The branch the loaded candidate list belongs to; null until a fetch settles. */
  fetchedFor: string | null;
  loading: boolean;
  candidates: ManagerCandidate[];
}

/**
 * Whether ManagerSelect should drop the current selection.
 *
 * Only once a candidate list for the CURRENT branch has actually arrived —
 * judging against an empty list that has not loaded yet is what used to wipe
 * an existing manager the moment the edit form opened, and a save then closed
 * their reporting line (and with it the leave approval chain).
 *
 * And only after the home branch has moved: on the branch the form opened with,
 * a manager missing from the list (deactivated, unmapped since) is still the
 * user's recorded manager, and silently clearing it on a save that never
 * touched the field would rewrite the hierarchy behind the admin's back.
 */
export function shouldClearManager(i: ClearInput): boolean {
  if (!i.value || i.loading) return false;
  if (i.fetchedFor !== i.homeOrgId) return false;
  if (i.homeOrgId === i.initialHomeOrgId) return false;
  return !i.candidates.some((c) => c.id === i.value);
}
