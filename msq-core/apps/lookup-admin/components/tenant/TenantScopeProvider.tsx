'use client';

import { createContext, useContext } from 'react';
import type { TenantOption } from '@/src/lib/tenant-cookie';

interface TenantScope {
  tenants: TenantOption[];
  selectedTenantId: string | undefined;
}

const TenantScopeContext = createContext<TenantScope>({
  tenants: [],
  selectedTenantId: undefined,
});

// Carries the header selector's choice to the client components that need it
// (create/edit modals, the capability matrix) without every page re-deriving it
// from its own search params or re-fetching the tenant list.
export default function TenantScopeProvider({
  tenants,
  selectedTenantId,
  children,
}: TenantScope & { children: React.ReactNode }) {
  return (
    <TenantScopeContext.Provider value={{ tenants, selectedTenantId }}>
      {children}
    </TenantScopeContext.Provider>
  );
}

export function useTenantScope(): TenantScope {
  return useContext(TenantScopeContext);
}
