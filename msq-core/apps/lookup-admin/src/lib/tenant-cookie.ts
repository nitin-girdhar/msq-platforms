// Client-safe half of the tenant scope: just the cookie name and the option
// shape. Kept apart from tenant-scope.ts because that module imports
// `next/headers`, which is server-only — a client component importing the
// cookie name from there drags `next/headers` into the browser bundle and the
// production build fails ("You're importing a component that needs
// next/headers"). `tsc --noEmit` does not catch it; only `next build` does.
export const TENANT_COOKIE = 'msq_admin_tenant_id';

export interface TenantOption {
  id: string;
  name: string;
}
