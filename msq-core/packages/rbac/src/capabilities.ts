// ── Capability keys (Tier C3) ───────────────────────────────────────────────
// GENERATED from iam.capabilities — do not hand-edit. Add a node to the seed in
// db_scripts/07_seed_lookup_data.sql, then regenerate.
//
// The keys form a TREE: tool -> page -> tab -> operation -> scope. Denying a node
// makes its whole subtree unreachable, whatever a descendant's own grant says.
// Nav (tool/page/tab) grants cascade; operations and scopes always need their own.
//
// Gate on these with `can()`. For an operation that owns a scope ladder, ask
// `resolveScope()` too — `can()` alone says the action is permitted, not whose
// rows it may touch.

export const CAPABILITY = {
  // ── Tools (7) ──
  ADMIN:          'admin',
  HR_ATTENDANCE:  'hr.attendance',
  HR_EMPLOYEES:   'hr.employees',
  HR_LEAVE:       'hr.leave',
  LMS:            'lms',
  PLATFORM:       'platform',
  TASKS:          'tasks',

  // ── Pages (13) ──
  ADMIN_LOOKUPS:        'admin.lookups',
  HR_ATTENDANCE_ADMIN:  'hr.attendance.admin',
  HR_LEAVE_ADMIN:       'hr.leave.admin',
  LMS_ANALYTICS:        'lms.analytics',
  LMS_APICLIENTS:       'lms.apiclients',
  LMS_ASSIGNMENTS:      'lms.assignments',
  LMS_CAMPAIGNS:        'lms.campaigns',
  LMS_DASHBOARD:        'lms.dashboard',
  LMS_FOLLOWUPS:        'lms.followups',
  LMS_HISTORY:          'lms.history',
  LMS_LEADS:            'lms.leads',
  LMS_USERS:            'lms.users',
  TASKS_LISTS:          'tasks.lists',

  // ── Tabs (9) ──
  HR_ATTENDANCE_ADMIN_ASSIGNMENTS:     'hr.attendance.admin.assignments',
  HR_ATTENDANCE_ADMIN_GEO_EXCEPTIONS:  'hr.attendance.admin.geo_exceptions',
  HR_ATTENDANCE_ADMIN_REPORTS:      'hr.attendance.admin.reports',
  HR_ATTENDANCE_ADMIN_RULES:        'hr.attendance.admin.rules',
  HR_ATTENDANCE_ADMIN_SHIFTS:       'hr.attendance.admin.shifts',
  HR_LEAVE_ADMIN_ADJUSTMENT:        'hr.leave.admin.adjustment',
  HR_LEAVE_ADMIN_CYCLE:             'hr.leave.admin.cycle',
  HR_LEAVE_ADMIN_HOLIDAYS:          'hr.leave.admin.holidays',
  HR_LEAVE_ADMIN_POLICIES:          'hr.leave.admin.policies',

  // ── Operations (68) ──
  ADMIN_LOOKUPS_MANAGE:                    'admin.lookups.manage',
  ADMIN_ROLES_MANAGE:                      'admin.roles.manage',
  HR_ATTENDANCE_ADMIN_ASSIGNMENTS_MANAGE:  'hr.attendance.admin.assignments.manage',
  HR_ATTENDANCE_ADMIN_ASSIGNMENTS_VIEW:    'hr.attendance.admin.assignments.view',
  HR_ATTENDANCE_ADMIN_GEO_EXCEPTIONS_MANAGE: 'hr.attendance.admin.geo_exceptions.manage',
  HR_ATTENDANCE_ADMIN_GEO_EXCEPTIONS_VIEW:   'hr.attendance.admin.geo_exceptions.view',
  HR_ATTENDANCE_ADMIN_REPORTS_VIEW:        'hr.attendance.admin.reports.view',
  HR_ATTENDANCE_ADMIN_RULES_UPDATE:        'hr.attendance.admin.rules.update',
  HR_ATTENDANCE_ADMIN_RULES_VIEW:          'hr.attendance.admin.rules.view',
  HR_ATTENDANCE_ADMIN_SHIFTS_MANAGE:       'hr.attendance.admin.shifts.manage',
  HR_ATTENDANCE_ADMIN_SHIFTS_VIEW:         'hr.attendance.admin.shifts.view',
  HR_ATTENDANCE_PHOTO_VIEW:                'hr.attendance.photo.view',
  HR_ATTENDANCE_PUNCH:                     'hr.attendance.punch',
  HR_ATTENDANCE_REGULARIZATION_APPROVE:    'hr.attendance.regularization.approve',
  HR_ATTENDANCE_REGULARIZATION_REJECT:     'hr.attendance.regularization.reject',
  HR_ATTENDANCE_REGULARIZATION_REQUEST:    'hr.attendance.regularization.request',
  HR_ATTENDANCE_VIEW:                      'hr.attendance.view',
  HR_EMPLOYEES_MANAGE:                     'hr.employees.manage',
  HR_EMPLOYEES_TAXONOMY_MANAGE:            'hr.employees.taxonomy.manage',
  HR_EMPLOYEES_VIEW:                       'hr.employees.view',
  HR_LEAVE_ADMIN_ADJUSTMENT_CREATE:        'hr.leave.admin.adjustment.create',
  HR_LEAVE_ADMIN_CYCLE_MANAGE:             'hr.leave.admin.cycle.manage',
  HR_LEAVE_ADMIN_HOLIDAYS_MANAGE:          'hr.leave.admin.holidays.manage',
  HR_LEAVE_ADMIN_HOLIDAYS_VIEW:            'hr.leave.admin.holidays.view',
  HR_LEAVE_ADMIN_POLICIES_MANAGE:          'hr.leave.admin.policies.manage',
  HR_LEAVE_ADMIN_POLICIES_VIEW:            'hr.leave.admin.policies.view',
  HR_LEAVE_APPROVE:                        'hr.leave.approve',
  HR_LEAVE_REJECT:                         'hr.leave.reject',
  HR_LEAVE_REQUEST_CANCEL:                 'hr.leave.request.cancel',
  HR_LEAVE_REQUEST_CREATE:                 'hr.leave.request.create',
  HR_LEAVE_VIEW:                           'hr.leave.view',
  LMS_ANALYTICS_ORG_VIEW:                  'lms.analytics.org.view',
  LMS_ANALYTICS_VIEW:                      'lms.analytics.view',
  LMS_APICLIENTS_MANAGE:                   'lms.apiclients.manage',
  LMS_APICLIENTS_VIEW:                     'lms.apiclients.view',
  LMS_ASSIGNMENTS_DELETE:                  'lms.assignments.delete',
  LMS_ASSIGNMENTS_EDIT:                    'lms.assignments.edit',
  LMS_ASSIGNMENTS_VIEW:                    'lms.assignments.view',
  LMS_CAMPAIGNS_MANAGE:                    'lms.campaigns.manage',
  LMS_CAMPAIGNS_VIEW:                      'lms.campaigns.view',
  LMS_DASHBOARD_VIEW:                      'lms.dashboard.view',
  LMS_FOLLOWUPS_CREATE:                    'lms.followups.create',
  LMS_FOLLOWUPS_DELETE:                    'lms.followups.delete',
  LMS_FOLLOWUPS_EDIT:                      'lms.followups.edit',
  LMS_FOLLOWUPS_VIEW:                      'lms.followups.view',
  LMS_HISTORY_VIEW:                        'lms.history.view',
  LMS_LEADS_ASSIGN:                        'lms.leads.assign',
  LMS_LEADS_CREATE:                        'lms.leads.create',
  LMS_LEADS_DELETE:                        'lms.leads.delete',
  LMS_LEADS_EDIT:                          'lms.leads.edit',
  LMS_LEADS_INTERACTION_LOG:               'lms.leads.interaction.log',
  LMS_LEADS_TIMELINE_VIEW:                 'lms.leads.timeline.view',
  LMS_LEADS_TRANSFER:                      'lms.leads.transfer',
  LMS_LEADS_UNASSIGNED_VIEW:               'lms.leads.unassigned.view',
  LMS_LEADS_VIEW:                          'lms.leads.view',
  LMS_LEADS_WHATSAPP_SEND:                 'lms.leads.whatsapp.send',
  LMS_USERS_MANAGE:                        'lms.users.manage',
  LMS_USERS_VIEW:                          'lms.users.view',
  PLATFORM_WRITE:                          'platform.write',
  TASKS_ASSIGN:                            'tasks.assign',
  TASKS_COMMENT:                           'tasks.comment',
  TASKS_CREATE:                            'tasks.create',
  TASKS_DELETE:                            'tasks.delete',
  TASKS_EDIT:                              'tasks.edit',
  TASKS_HISTORY_VIEW:                      'tasks.history.view',
  TASKS_LISTS_DELETE:                      'tasks.lists.delete',
  TASKS_LISTS_MANAGE:                      'tasks.lists.manage',
  TASKS_LISTS_VIEW:                        'tasks.lists.view',
  TASKS_VIEW:                              'tasks.view',

  // ── Scopes — read with resolveScope(), not can() (29) ──
  HR_ATTENDANCE_VIEW_ORG:    'hr.attendance.view.org',
  HR_ATTENDANCE_VIEW_OWN:    'hr.attendance.view.own',
  HR_ATTENDANCE_VIEW_TEAM:   'hr.attendance.view.team',
  HR_LEAVE_VIEW_ORG:         'hr.leave.view.org',
  HR_LEAVE_VIEW_OWN:         'hr.leave.view.own',
  HR_LEAVE_VIEW_TEAM:        'hr.leave.view.team',
  HR_LEAVE_VIEW_TENANT:      'hr.leave.view.tenant',
  LMS_HISTORY_VIEW_ALL:      'lms.history.view.all',
  LMS_HISTORY_VIEW_ORG:      'lms.history.view.org',
  LMS_HISTORY_VIEW_OWN:      'lms.history.view.own',
  LMS_HISTORY_VIEW_TEAM:     'lms.history.view.team',
  LMS_HISTORY_VIEW_TENANT:   'lms.history.view.tenant',
  LMS_LEADS_ASSIGN_ANY:      'lms.leads.assign.any',
  LMS_LEADS_ASSIGN_PEERS:    'lms.leads.assign.peers',
  LMS_LEADS_ASSIGN_REPORTS:  'lms.leads.assign.reports',
  LMS_LEADS_EDIT_ANY:        'lms.leads.edit.any',
  LMS_LEADS_EDIT_OWN:        'lms.leads.edit.own',
  LMS_LEADS_EDIT_TEAM:       'lms.leads.edit.team',
  LMS_LEADS_VIEW_ORG:        'lms.leads.view.org',
  LMS_LEADS_VIEW_OWN:        'lms.leads.view.own',
  LMS_LEADS_VIEW_TEAM:       'lms.leads.view.team',
  LMS_USERS_VIEW_ORG:        'lms.users.view.org',
  LMS_USERS_VIEW_TEAM:       'lms.users.view.team',
  TASKS_EDIT_ANY:            'tasks.edit.any',
  TASKS_EDIT_OWN:            'tasks.edit.own',
  TASKS_EDIT_TEAM:           'tasks.edit.team',
  TASKS_VIEW_ORG:            'tasks.view.org',
  TASKS_VIEW_OWN:            'tasks.view.own',
  TASKS_VIEW_TEAM:           'tasks.view.team',

} as const;

export type CapabilityKey = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** Scope names in ascending breadth. Mirrors sort_order on the scope nodes. The
 *  vocabulary is fixed at these five and must not grow per feature. */
export const SCOPE = ['own', 'team', 'org', 'tenant', 'all'] as const;
export type ScopeName = (typeof SCOPE)[number];

/** Anything carrying a resolved capability list: a SessionUser (from /auth/me) or
 *  a service's request.auth. Both are filled from the same DB matrix. */
export interface CapabilityHolder {
  capabilities: readonly string[] | ReadonlySet<string>;
}

function holds(actor: CapabilityHolder, key: string): boolean {
  const caps = actor.capabilities;
  return caps instanceof Set ? caps.has(key) : (caps as readonly string[]).includes(key);
}

/**
 * Is `key` part of the PLATFORM ADMINISTRATION subtree — the `admin` tool and
 * everything under it?
 *
 * That subtree gates exactly one surface: the lookup-admin console, which is
 * super_admin-only and stays that way. Every route behind it re-checks
 * `rank >= SUPER_ADMIN` in admin-service on its own, and super_admin receives
 * these capabilities through the `*` wildcard grant in db_scripts/07 rather than
 * through per-key rows. So granting one of these keys to a tenant role is never
 * something an operator wants: it cannot make the console work, only make it
 * open onto a screen where every call 403s. This predicate is what lets both
 * sides refuse that.
 *
 * A prefix test, for the same reason holdsUsableNode() is one: keys nest by
 * construction, so the subtree IS the prefix. The dot guard matters — a future
 * tool named `administration` must not be swept in.
 *
 * NOT to be confused with the HR and Tasks admin surfaces. `hr.leave.admin.*`,
 * `hr.attendance.admin.*` and `tasks.lists.*` are ordinary tenant capabilities,
 * enforced route-by-route in hr-service and tasks-service, and are freely
 * assignable. Only the `admin` ROOT is platform administration.
 *
 * Lives here rather than in admin-service for the reason holdsUsableNode() lives
 * here: it is asked on BOTH sides of one decision — the write validation in
 * admin-service's putGrants, and the row state on the Capability Matrix screen.
 * If those two ever disagree the screen offers a save the server rejects, which
 * is the same render-then-403 shape this package exists to prevent.
 */
export function isPlatformAdminCapability(key: string): boolean {
  return key === CAPABILITY.ADMIN || key.startsWith(`${CAPABILITY.ADMIN}.`);
}

/**
 * Does this actor hold `key`?
 *
 * Fails CLOSED — a missing or empty list denies. For a scoped operation this
 * answers "may they do it at all"; pair it with resolveScope() for "over whose
 * rows", or the query returns nothing and reads as a bug.
 */
export function can(actor: CapabilityHolder | null | undefined, key: CapabilityKey): boolean {
  return actor ? holds(actor, key) : false;
}

/**
 * Is `key` a nav node the actor can actually OPEN — as opposed to merely holding?
 *
 * Needs BOTH of:
 *   1. the node itself granted, and
 *   2. at least one granted capability BENEATH it.
 *
 * The second condition matters because nav grants cascade: granting the `lms`
 * tool lights up every page under it, including ones whose operations the role
 * was never given. Without this check a tenant-defined role would see Analytics,
 * click it, and get an empty screen — the render-then-403 bug this whole model
 * exists to remove. A node with nothing usable under it is not one you can open.
 *
 * Derived, not another grant: keys nest by construction, so "is anything granted
 * below this node" is a prefix test over the same list.
 *
 * Lives here rather than in the UI package because it is asked on BOTH sides of
 * every nav decision: the sidebar filter (@platform/ui-kit's filterNav, and
 * products.ts one level up for the product switcher) and the page guard behind
 * each link (@lms/authz's canOpenX). Those two must ask the identical question
 * or a link can appear that its own page bounces — and @lms/authz has no
 * business depending on a React package to find out.
 */
export function holdsUsableNode(
  actor: CapabilityHolder | null | undefined,
  key: CapabilityKey,
): boolean {
  if (!actor) return false;
  const held = actor.capabilities instanceof Set
    ? [...actor.capabilities]
    : (actor.capabilities as readonly string[]);

  return can(actor, key) && held.some((k) => k.startsWith(`${key}.`));
}

/**
 * The broadest scope held under `operationKey`, or null if none — which means the
 * operation is unusable even where can() is true.
 *
 * Breadth, not grant order, decides: holding `all` without `own` still resolves to
 * `all`, because a wider scope is a superset of a narrower one. `any` is the widest
 * rung on the edit/assign ladders and maps to org-wide reach.
 */
export function resolveScope(
  actor: CapabilityHolder | null | undefined,
  operationKey: CapabilityKey,
): ScopeName | null {
  if (!actor) return null;
  if (holds(actor, `${operationKey}.any`)) return 'all';
  for (let i = SCOPE.length - 1; i >= 0; i--) {
    const name = SCOPE[i] as ScopeName;
    if (holds(actor, `${operationKey}.${name}`)) return name;
  }
  return null;
}
