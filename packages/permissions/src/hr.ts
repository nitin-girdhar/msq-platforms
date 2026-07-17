import { RANKS } from './ranks.js';

/**
 * True when the acting user is the dedicated HR role, regardless of rank.
 * hr_admin sits at rank 75 (below org_admin's 80) but must still manage HR
 * data — role name is checked in addition to rank so an org_admin's higher
 * rank alone doesn't imply HR-admin-only semantics elsewhere.
 */
export function isHrAdmin(role: string): boolean {
  return role === 'hr_admin';
}

/**
 * Whether the acting user may create/update employee profiles, departments,
 * and designations for their org: org_admin+ (rank >= 80) or the hr_admin role.
 */
export function canManageEmployees(role: string, rank: number): boolean {
  return rank >= RANKS.ADMIN || isHrAdmin(role);
}

/**
 * Whether the acting user may manage leave configuration (policies, holidays,
 * settings, manual ledger adjustments) for their org: org_admin+ or hr_admin.
 * Mirrors canManageEmployees — same HR-admin semantics.
 */
export function canManageLeave(role: string, rank: number): boolean {
  return rank >= RANKS.ADMIN || isHrAdmin(role);
}

/**
 * Whether the acting user may act as an approval-override on any in-org leave
 * request (independent of being the resolved approver): org_admin+ or hr_admin.
 */
export function canOverrideLeaveApproval(role: string, rank: number): boolean {
  return rank >= RANKS.ADMIN || isHrAdmin(role);
}

/**
 * Whether the acting user may see a team/subtree leave queue at all:
 * org_manager+ (rank >= 60), hr_admin, or org_admin.
 */
export function canViewTeamLeave(role: string, rank: number): boolean {
  return rank >= RANKS.MANAGER || isHrAdmin(role);
}

/** Tenant-wide leave policy/settings authority: tenant_admin / super_admin. */
export function isTenantLeaveAdmin(role: string, rank: number): boolean {
  return rank >= RANKS.TENANT_ADMIN || role === 'tenant_admin' || role === 'super_admin';
}

// ── Attendance ────────────────────────────────────────────────────────────────
// Attendance shares the same authority model as leave (org_admin+ or hr_admin for
// configuration; org_manager+ for team views). Dedicated names keep call sites
// self-documenting without duplicating the logic.

/**
 * Whether the acting user may manage attendance configuration — rules, shifts,
 * shift assignments — for their org: org_admin+ (rank >= 80) or hr_admin.
 */
export function canManageAttendance(role: string, rank: number): boolean {
  return rank >= RANKS.ADMIN || isHrAdmin(role);
}

/** Alias for shift/shift-assignment management (same authority as attendance config). */
export function canManageShifts(role: string, rank: number): boolean {
  return canManageAttendance(role, rank);
}

/**
 * Whether the acting user may see a team/subtree attendance view at all:
 * org_manager+ (rank >= 60), hr_admin, or org_admin.
 */
export function canViewTeamAttendance(role: string, rank: number): boolean {
  return rank >= RANKS.MANAGER || isHrAdmin(role);
}

/**
 * Whether the acting user may act as an approval-override on any in-org attendance
 * regularization (independent of being the resolved approver): org_admin+ or hr_admin.
 */
export function canOverrideAttendanceApproval(role: string, rank: number): boolean {
  return rank >= RANKS.ADMIN || isHrAdmin(role);
}
