'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * The tenant (and optional branch) a user-management screen is administering,
 * when that is NOT the actor's own session tenant.
 *
 * Only lookup-admin (/sa) sets it: a super_admin picks a Tenant / Org in the
 * navbar and manages that tenant's users without re-minting their own session.
 * Every other host renders no provider, the value is `{}`, and every call below
 * behaves exactly as before — scoped by the session server-side.
 *
 * Advisory only. identity-service honours `tenant_id` for super_admin alone,
 * proves any `org_id` sits inside it, and 404s a user outside it
 * (users.service.ts resolveTargetScope / scopeContext).
 */
export interface UserAdminScope {
  tenant_id?: string;
  org_id?: string;
}

const UserAdminScopeContext = createContext<UserAdminScope>({});

export function UserAdminScopeProvider({
  tenantId,
  orgId,
  children,
}: {
  tenantId: string;
  orgId?: string | undefined;
  children: ReactNode;
}) {
  const value = useMemo<UserAdminScope>(
    () => ({ tenant_id: tenantId, ...(orgId ? { org_id: orgId } : {}) }),
    [tenantId, orgId],
  );
  return <UserAdminScopeContext.Provider value={value}>{children}</UserAdminScopeContext.Provider>;
}

export function useUserAdminScope(): UserAdminScope {
  return useContext(UserAdminScopeContext);
}
