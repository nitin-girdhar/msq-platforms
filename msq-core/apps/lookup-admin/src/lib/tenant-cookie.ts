// The cookie the top-level tenant selector writes and every server component
// reads. Kept in its own module with NO imports: the client selector needs the
// name too, and importing it from tenant-scope.ts would drag `next/headers`
// into the client bundle (which fails the build).
export const TENANT_COOKIE = 'admin_tenant_id';

export interface TenantOption {
  id: string;
  name: string;
}
