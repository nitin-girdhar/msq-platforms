export const ROLES = [
  'read_only',
  'sales_representative',
  'senior_sales_executive',
  'org_manager',
  'org_sr_manager',
  'hr_admin',
  'org_admin',
  'tenant_admin',
  'super_admin',
] as const;

export type UserRole = (typeof ROLES)[number];

export const ROLE_RANK: Record<UserRole, number> = {
  read_only: 0,
  sales_representative: 20,
  senior_sales_executive: 40,
  org_manager: 60,
  org_sr_manager: 70,
  hr_admin: 75,
  org_admin: 80,
  tenant_admin: 90,
  super_admin: 100,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  read_only: 'Read Only',
  sales_representative: 'Sales Representative',
  senior_sales_executive: 'Senior Sales Executive',
  org_manager: 'Manager',
  org_sr_manager: 'Senior Manager',
  hr_admin: 'HR Admin',
  org_admin: 'Admin',
  tenant_admin: 'Tenant Admin',
  super_admin: 'Super Admin',
};

export const ROLE_TIERS = {
  ADMIN: ['super_admin', 'tenant_admin', 'org_admin'] as const,
  MANAGER: ['org_sr_manager', 'org_manager'] as const,
  SSE: ['senior_sales_executive'] as const,
  SE: ['sales_representative'] as const,
  READ_ONLY: ['read_only'] as const,
} satisfies Record<string, readonly UserRole[]>;

// ── Platform roles (P1.3 shrunk JWT) ────────────────────────────────────────
// The coarse cross-product role that survives in the JWT. Product authority no
// longer lives here — it comes from <product>.member_roles, resolved per service.
// `platform_role` drives (a) which Postgres role withRoleTx selects (RLS) and
// (b) platform-wide gates (cross-org visibility, tenant/user administration).
export const PLATFORM_ROLES = ['super_admin', 'tenant_admin', 'org_admin', 'member'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

// Coarse platform rank ladder — used ONLY for platform-level gates in shared
// services (tenant/org/user administration). Product gates use per-product
// scales in each */authz package, never this.
export const PLATFORM_RANK: Record<PlatformRole, number> = {
  member: 0,
  org_admin: 80,
  tenant_admin: 90,
  super_admin: 100,
};

// Maps platform_role to the PostgreSQL role that enforces the correct RLS scope.
// Mirrors APP_ROLE_TO_PG_ROLE but keyed on the coarse platform role. withRoleTx
// branches on the same super_admin/tenant_admin/else split, so the RLS boundary
// is identical to the pre-P1.3 behavior.
export const PLATFORM_ROLE_TO_PG_ROLE = {
  super_admin:  'root_service',
  tenant_admin: 'tenant_admin',
  org_admin:    'app_user',
  member:       'app_user',
} as const satisfies Record<PlatformRole, 'app_user' | 'tenant_admin' | 'root_service'>;

export const AUTH_ROUTES = {
  login: '/login',
  dashboard: '/dashboard/leads',
} as const;

// Maps each application role to the PostgreSQL role that enforces the correct
// RLS scope.  Used by withRoleTx() in @crm/db to select the right connection
// pool and SET LOCAL ROLE statement.
export const APP_ROLE_TO_PG_ROLE = {
  read_only:               'app_user',
  sales_representative:    'app_user',
  senior_sales_executive:  'app_user',
  org_manager:             'app_user',
  org_sr_manager:          'app_user',
  hr_admin:                'app_user',
  org_admin:               'app_user',
  tenant_admin:            'tenant_admin',
  super_admin:             'root_service',
} as const satisfies Record<UserRole, 'app_user' | 'tenant_admin' | 'root_service'>;
