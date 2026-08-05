/**
 * May an actor of `actorRank` create/assign a user holding `targetRank`?
 *
 * A seniority question, not a capability. Unlike msq-lms's identically-named
 * helper, this app has no MANAGER-tier floor to check: the dashboard layout
 * already gates the whole console at org_admin+ (see app/dashboard/layout.tsx),
 * so every actor who reaches this code is already above that floor.
 */
export function canCreateUser(actorRank: number, targetRank: number): boolean {
  return actorRank > targetRank;
}
