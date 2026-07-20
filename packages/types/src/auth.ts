import type { ROLES, PlatformRole } from '@crm/auth-constants';

export type UserRole = (typeof ROLES)[number];

export type { PlatformRole };

/**
 * Coarse product identifier. Also declared as the source of truth here so the
 * shrunk JWT (`licensed_products`) and `@platform/authz` share one definition
 * without a circular import (`@platform/authz` re-exports this).
 */
export type ProductKey = 'lms' | 'hr' | 'task';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  rank: number;
  org_id: string;
  org_name: string;
  tenant_id: string;
  tenant_name: string;
  role_label: string;
  name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  manager_id: string | null;
  manager_name: string | null;
  last_login_at: string | null;
  mobile: string | null;
  is_active: boolean;
  force_password_change: boolean;
}

// One branch a user can act in, derived from an active iam.user_org_mapping row.
export interface UserOrgOption {
  org_id: string;
  org_name: string;
  role: UserRole;
  role_label: string;
  rank: number;
  /** True when this org is the user's home org (iam.users.org_id). */
  is_home: boolean;
}

/**
 * The shrunk platform JWT (P1.3). Carries only identity, the coarse
 * `platform_role`, tenancy, and the tenant's licensed products — NO global
 * product role/rank. Each product service resolves the acting user's product
 * role/rank from its own `<product>.member_roles` table; identity-service
 * resolves the global-ladder rank from `iam`. See docs/Architecture.md.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  /** Coarse cross-product role; drives PG-role selection (RLS) + platform gates. */
  platform_role: PlatformRole;
  org_id: string;
  tenant_id: string;
  /** Products the acting tenant has licensed (UX convenience; the gateway's
   *  entitlement gate remains the authoritative DB-backed check). */
  licensed_products: ProductKey[];
  pwd_iat: number;
  jti: string;
  /** Set to true when the user must change their password before any other action */
  force_password_change?: boolean;
  iat?: number;
  exp?: number;
}

export type JwtVerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: 'expired' | 'invalid' | 'missing' };
