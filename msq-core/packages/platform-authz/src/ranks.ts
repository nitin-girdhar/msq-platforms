import { PLATFORM_RANK, type PlatformRole } from '@platform/auth-constants';

// ── Platform rank tiers (P1.3) ──────────────────────────────────────────────
// The shared global ladder is dissolved: each product package now owns its own
// rank scale (LMS_RANKS / HR_RANKS / TASK_RANKS). `@platform/authz` keeps ONLY
// the coarse platform tiers, used for platform-level gates in shared services
// (tenant/org/user administration) — never for product authority.
//
// `ADMIN` is retained as an alias of `ORG_ADMIN` (80) for existing shared-service
// call sites that read `RANKS.ADMIN`.
export const RANKS = {
  MEMBER: PLATFORM_RANK.member,            // 0
  ADMIN: PLATFORM_RANK.org_admin,          // 80 (org_admin)
  ORG_ADMIN: PLATFORM_RANK.org_admin,      // 80
  TENANT_ADMIN: PLATFORM_RANK.tenant_admin, // 90
  SUPER_ADMIN: PLATFORM_RANK.super_admin,  // 100
} as const;

/** The coarse platform rank for a platform_role. Used by shared services that
 *  gate purely on platform tiers (admin/meta). */
export function platformRank(role: PlatformRole): number {
  return PLATFORM_RANK[role];
}
