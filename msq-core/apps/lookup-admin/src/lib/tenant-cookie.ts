// Client-safe option shape for the tenant list (fetchTenants). The SA-only
// Tenant/Org cookies that used to live here are gone: the SA console now scopes
// by the session's tenant/branch switcher (see tenant-scope.ts).
export interface TenantOption {
  id: string;
  name: string;
}
