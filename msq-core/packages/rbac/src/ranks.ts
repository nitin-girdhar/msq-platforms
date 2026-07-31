// ── The unified rank ladder (Tier C) ────────────────────────────────────────
// ONE ladder, stored in iam.user_roles.rank and resolved server-side by
// iam.fn_user_org_rank. It replaces the three scales that used to disagree
// (global iam rank, coarse platform rank, per-product member_roles rank) — the
// direct cause of the "page renders but every call 403s" bugs.
//
// Only the FOUR anchor roles have fixed ranks. Every other role is tenant data,
// tied to a department, with a rank an admin chooses in the OPEN BAND below.
// Never hard-code those — read them from the DB.
//
// WHERE THE ROWS LIVE (changed by _migrations/23_tenant_scope_admin_roles.sql):
// only `super_admin` is still a global row (tenant_id IS NULL). read_only,
// org_admin and tenant_admin now exist as one copy PER TENANT, so a tenant can
// re-permission its own admins without touching another tenant. Their RANKS
// remain fixed and are not operator-editable — the admin UI locks the field and
// admin-service re-asserts the value on write — because platform_role derivation
// and PG-role selection both resolve off these names/ranks.

/** Fixed ranks for the four anchor roles. These are the ONLY rank literals that
 *  may appear in code; everything else is data. Mirrors db_scripts/07 seed. */
export const ANCHOR_RANK = {
  READ_ONLY:    0,
  ORG_ADMIN:    980,
  TENANT_ADMIN: 990,
  SUPER_ADMIN:  1000,
} as const;

/** Matches CHECK (rank >= 0 AND rank <= 1000) on iam.user_roles. */
export const RANK_CEILING = 1000;

/** Ranks available to tenant-defined, department-scoped roles: 1..979. */
export const DYNAMIC_RANK_MIN = 1;
export const DYNAMIC_RANK_MAX = ANCHOR_RANK.ORG_ADMIN - 1;

/**
 * Roles whose rank is a platform contract rather than operator data.
 *
 * Since _migrations/23 these exist as per-tenant rows, so they show up on the
 * admin console's User Roles screen and are editable like any other row — but
 * their rank is not. `read_only` is also the reason this map exists rather than
 * a simple `>= 980` test: its rank is 0, which sits BELOW the dynamic band, so a
 * range check alone would reject it.
 *
 * Enforced in admin-service (authoritative) and mirrored by a locked field in
 * the admin UI (convenience only).
 */
export const RESERVED_ROLE_RANK: Readonly<Record<string, number>> = {
  read_only:    ANCHOR_RANK.READ_ONLY,
  org_admin:    ANCHOR_RANK.ORG_ADMIN,
  tenant_admin: ANCHOR_RANK.TENANT_ADMIN,
};

/**
 * The one role that stays global (tenant_id IS NULL) and is never listed or
 * assignable from the admin console — it acts across tenants by design, so it
 * belongs to no tenant and must not be handed out by accident.
 */
export const GLOBAL_ONLY_ROLE = 'super_admin';

/**
 * Ranks of the GLOBAL DEFAULT roles the platform ships with (db_scripts/07).
 * Unlike the anchors these are ordinary data — a tenant may re-rank them or
 * replace them with department-scoped roles — but the shipped values live here
 * so product gates have ONE place to reference instead of scattering literals.
 *
 * Prefer a department-aware helper (canAdministerArea) over comparing to these
 * directly; C3 replaces both with a capability lookup.
 */
export const DEFAULT_ROLE_RANK = {
  SALES_REPRESENTATIVE:   20,
  SENIOR_SALES_EXECUTIVE: 40,
  ORG_MANAGER:            60,
  ORG_SR_MANAGER:         70,
  HR_ADMIN:               75,
} as const;

/** Sentinel returned by the rank resolvers when a user has no active role in
 *  the org (iam.fn_user_org_rank returns -1). Distinct from READ_ONLY (0). */
export const NO_ACCESS_RANK = -1;

export type AnchorRank = (typeof ANCHOR_RANK)[keyof typeof ANCHOR_RANK];
