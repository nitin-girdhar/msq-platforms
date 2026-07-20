// ── Tasks ───────────────────────────────────────────────────────────────────
// Task authority is rank-based and self-documenting. Fine-grained per-task rules
// (creator / assignee / manager-of-assignee) are enforced in the tasks-service
// against the specific rows; these helpers cover the coarse scope gates.
//
// ── Task product rank scale (P1.3) ──────────────────────────────────────────
// Owned by @task/authz; comparable only WITHIN Tasks. Mirrors task.roles.rank in
// db_scripts/17_init-per-product-roles.sql:
//   task_member 20 · task_lead 40 · task_admin 80
// `rank` below is the Task PRODUCT rank (from task.member_roles), resolved per
// request by tasks-service.
export const TASK_RANKS = {
  MEMBER: 20,
  LEAD: 40,
  ADMIN: 80,
} as const;

/** May request the team/subtree task scope (?scope=team): task_lead+ (rank ≥ 40). */
export function canViewTeamTasks(rank: number): boolean {
  return rank >= TASK_RANKS.LEAD;
}

/** May request the whole-org task scope (?scope=org): task_admin (rank ≥ 80). */
export function canViewOrgTasks(rank: number): boolean {
  return rank >= TASK_RANKS.ADMIN;
}

/**
 * May administer any in-org task or task list regardless of ownership —
 * PATCH/DELETE another user's task, delete any list: task_admin (rank ≥ 80).
 */
export function canAdministerTasks(rank: number): boolean {
  return rank >= TASK_RANKS.ADMIN;
}
