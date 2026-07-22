import { ANCHOR_RANK, NO_ACCESS_RANK } from './ranks.js';

// ── Hierarchy questions (rank only) ─────────────────────────────────────────
// "Is A senior to B?" / "Does A clear this tier?" Rank is an ORDERING device.
// It is NOT the answer to "may A open this tool" — see the area helpers below,
// and ultimately the C3 capability matrix.

/** The user has some active role in this org. */
export function hasOrgAccess(rank: number): boolean {
  return rank > NO_ACCESS_RANK;
}

export function isAtLeast(rank: number, floor: number): boolean {
  return rank >= floor;
}

export const isReadOnly    = (rank: number): boolean => rank === ANCHOR_RANK.READ_ONLY;
export const isOrgAdmin    = (rank: number): boolean => rank >= ANCHOR_RANK.ORG_ADMIN;
export const isTenantAdmin = (rank: number): boolean => rank >= ANCHOR_RANK.TENANT_ADMIN;
export const isSuperAdmin  = (rank: number): boolean => rank >= ANCHOR_RANK.SUPER_ADMIN;

/** Tenant-wide actors see across every org in their tenant. */
export const isTenantWide  = (rank: number): boolean => rank >= ANCHOR_RANK.TENANT_ADMIN;

/** A may manage B only if strictly senior. Equal ranks cannot manage each other. */
export function canManage(actorRank: number, targetRank: number): boolean {
  return actorRank > targetRank;
}

// ── Department (Tier C1) ────────────────────────────────────────────────────
// Departments answer "which part of the business does this role belong to" and
// scope role NAMES and RANKS per tenant (iam.user_roles is unique on
// tenant + department + rank). They no longer answer "may this role open this
// tool" — the C2 interim `canAccessArea` did that, and C3 replaced it with the
// DB-driven capability matrix (see capabilities.ts / `can()`), because
// department ownership could not express per-tenant exceptions without a deploy.

/** Departments seeded for every tenant (db_scripts/08). Tenants may add more. */
export const DEPARTMENT = {
  SALES:      'sales',
  HR:         'hr',
  OPERATIONS: 'operations',
  ADMIN:      'admin',
} as const;
export type DepartmentName = (typeof DEPARTMENT)[keyof typeof DEPARTMENT];

export interface RbacActor {
  rank: number;
  /** iam.user_roles.department_id → iam.departments.name; null for anchor roles. */
  department?: string | null;
}
