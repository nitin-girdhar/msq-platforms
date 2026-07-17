import { RANKS } from './ranks.js';

// ── Tasks ───────────────────────────────────────────────────────────────────
// Task authority is rank-based and self-documenting. Fine-grained per-task rules
// (creator / assignee / manager-of-assignee) are enforced in the tasks-service
// against the specific rows; these helpers cover the coarse scope gates.

/** May request the team/subtree task scope (?scope=team): org_manager+ (rank ≥ 60). */
export function canViewTeamTasks(rank: number): boolean {
  return rank >= RANKS.MANAGER;
}

/** May request the whole-org task scope (?scope=org): org_admin+ (rank ≥ 80). */
export function canViewOrgTasks(rank: number): boolean {
  return rank >= RANKS.ADMIN;
}

/**
 * May administer any in-org task or task list regardless of ownership —
 * PATCH/DELETE another user's task, delete any list: org_admin+ (rank ≥ 80).
 */
export function canAdministerTasks(rank: number): boolean {
  return rank >= RANKS.ADMIN;
}
