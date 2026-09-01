import { users as usersResource } from '@platform/ui-kit';
import type { SessionUser } from '@platform/types';

// Thin typed wrappers around @platform/ui-kit's shared `users` resource rather
// than a second copy of the fetch/URL logic. Moved here from admin-web when the
// Team screen became a shared module: the screen owns the shape of the calls it
// makes, so a second host app mounting it does not have to re-declare them.
//
// No org_id param is ever sent: identity-service scopes /users to the caller's
// own org/tenant from the gateway-verified session (see users.service.ts
// listUsers — org_id is only honoured for actors above org_admin's own-org
// ceiling), and `scope` is likewise resolved server-side from the actor's
// admin.team.view.* rung, so a client asking for more than it holds is
// downgraded rather than obeyed.

// One row of GET /users/assignable — see getAssignableUsers in
// identity-service's users.repository.ts for the SELECT this mirrors.
export interface AssignableUser {
  id: string;
  org_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  role_name: string;
  role_label: string;
  rank: number;
}

export const users = {
  list: () => usersResource.list() as Promise<{ success: true; data: SessionUser[]; total: number; page: number; page_size: number }>,

  // Who may actually be handed this product's work in a branch. Gated
  // server-side on the product's CAPABILITY node, so it excludes staff who sit
  // on the same rank ladder but do not work that product — never filter the
  // plain roster by hand for an assignee list.
  assignable: (opts: { product: 'lms' | 'tasks'; orgId?: string }) =>
    usersResource.assignable(opts) as Promise<{ success: true; data: AssignableUser[] }>,

  create: (body: Record<string, unknown>) => usersResource.create(body),

  update: (id: string, body: Record<string, unknown>) => usersResource.update(id, body),

  // Every branch the user holds. The Edit form needs the full set to send back a
  // complete assignment list; the roster row only carries their home branch.
  orgMappings: (id: string) => usersResource.orgMappings(id),

  resetPassword: (
    id: string,
    new_password?: string,
    override_policy?: boolean,
    force_password_change?: boolean,
    send_email_notification?: boolean,
  ) => usersResource.resetPassword(id, new_password, override_policy, force_password_change, send_email_notification),
};
