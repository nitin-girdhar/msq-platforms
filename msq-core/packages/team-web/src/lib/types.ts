import type { SessionUser } from '@platform/types';

/** Which slice of the roster. Mirrors identity-service's listUsersQuerySchema. */
export type TeamScope = 'reports' | 'org' | 'tenant';

/**
 * A roster row: a SessionUser plus the fields only this screen's query returns.
 *
 * Lives here rather than in `../server` so a client component can name the type
 * without referencing the server-only module at all — `import type` erases, but
 * a neutral home means nobody has to remember that.
 *
 * `report_depth` is 1 for a direct report and climbs with each level below,
 * straight from iam.vw_user_team_members. It is NULL outside the `reports`
 * scope, where the roster is a branch or a tenant rather than a subtree and
 * depth would be meaningless — so treat null as "not a hierarchy view", never
 * as "top level".
 */
export type TeamRow = SessionUser & {
  report_depth?: number | null;
};
