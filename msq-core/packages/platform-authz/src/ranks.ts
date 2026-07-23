import { PLATFORM_RANK, type PlatformRole } from '@platform/auth-constants';

// ── Platform rank tiers (P1.3) ──────────────────────────────────────────────
// The shared global ladder is dissolved: each product package now owns its own
// rank scale (LMS_RANKS / HR_RANKS / TASK_RANKS). `@platform/authz` keeps ONLY
// the coarse platform tiers, used for platform-level gates in shared services
// (tenant/org/user administration) — never for product authority.
//
// `ADMIN` is retained as an alias of `ORG_ADMIN` (980) for existing shared-service
// call sites that read `RANKS.ADMIN`.
//
// Values come from PLATFORM_RANK, kept in lockstep with @platform/rbac ANCHOR_RANK
// and the db_scripts/07 seed — the unified ladder (0 / 980 / 990 / 1000), NOT the
// old coarse 0/80/90/100 scale that predated Tier C.
export const RANKS = {
  MEMBER: PLATFORM_RANK.member,            // 0
  ADMIN: PLATFORM_RANK.org_admin,          // 980 (org_admin)
  ORG_ADMIN: PLATFORM_RANK.org_admin,      // 980
  TENANT_ADMIN: PLATFORM_RANK.tenant_admin, // 990
  SUPER_ADMIN: PLATFORM_RANK.super_admin,  // 1000
} as const;

/** The coarse platform rank for a platform_role. Used by shared services that
 *  gate purely on platform tiers (admin/meta). */
export function platformRank(role: PlatformRole): number {
  return PLATFORM_RANK[role];
}
