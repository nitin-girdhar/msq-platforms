// ── Capability keys (Tier C3 groundwork) ────────────────────────────────────
// The stable string keys that will be rows in iam.capabilities, with per-tenant
// enable/disable in iam.role_capabilities. They live here — in the shared
// platform package — so every product imports the SAME key, including
// product-specific ones. Changing an access rule then means changing data, not
// code.
//
// C3 adds hasCapability(role, key) backed by a startup-loaded cache that is
// invalidated via Postgres LISTEN/NOTIFY. Until then these are declared but not
// yet enforced; the department-aware predicates carry the gates.

export const CAPABILITY = {
  // ── LMS / leads ──
  LMS_LEADS_VIEW:     'lms.leads.view',
  LMS_LEADS_EDIT:     'lms.leads.edit',
  LMS_LEADS_DELETE:   'lms.leads.delete',
  LMS_LEADS_TRANSFER: 'lms.leads.transfer',
  LMS_ANALYTICS_VIEW: 'lms.analytics.view',
  LMS_USERS_MANAGE:   'lms.users.manage',
  LMS_ADMIN:          'lms.admin',

  // ── HR ──
  HR_ATTENDANCE_VIEW:  'hr.attendance.view',
  HR_ATTENDANCE_TEAM:  'hr.attendance.team',
  HR_ATTENDANCE_ADMIN: 'hr.attendance.admin',
  HR_LEAVE_VIEW:       'hr.leave.view',
  HR_LEAVE_APPROVE:    'hr.leave.approve',
  HR_LEAVE_ADMIN:      'hr.leave.admin',
  HR_EMPLOYEES_MANAGE: 'hr.employees.manage',
  HR_ADMIN:            'hr.admin',

  // ── Tasks ──
  TASKS_VIEW:   'tasks.view',
  TASKS_EDIT:   'tasks.edit',
  TASKS_TEAM_VIEW: 'tasks.team.view',
  TASKS_ASSIGN: 'tasks.assign',
  TASKS_ADMIN:  'tasks.admin',

  // ── Platform administration ──
  ADMIN_ORGS_MANAGE:    'admin.orgs.manage',
  ADMIN_USERS_MANAGE:   'admin.users.manage',
  ADMIN_ROLES_MANAGE:   'admin.roles.manage',
  ADMIN_LOOKUPS_MANAGE: 'admin.lookups.manage',
} as const;

export type CapabilityKey = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** Anything carrying a resolved capability list: a SessionUser (from /auth/me)
 *  or a service's request.auth. Both are filled from the same DB matrix. */
export interface CapabilityHolder {
  capabilities: readonly string[] | ReadonlySet<string>;
}

/**
 * Does this actor hold `key`?
 *
 * Fails CLOSED — a missing or empty list denies. Prefer this over comparing
 * ranks: a rank answers "who is senior", a capability answers "who may do this",
 * and only the second is editable per tenant without a deploy.
 */
export function can(actor: CapabilityHolder | null | undefined, key: CapabilityKey): boolean {
  if (!actor) return false;
  const caps = actor.capabilities;
  return caps instanceof Set ? caps.has(key) : (caps as readonly string[]).includes(key);
}
