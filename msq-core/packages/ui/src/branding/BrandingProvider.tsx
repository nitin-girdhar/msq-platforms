'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { DEFAULT_BRANDING, type Branding, type BrandProductKey, type BrandTermKey } from './types';

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

/**
 * Supplies the session tenant's branding to client components. Each root
 * layout resolves it once on the server (getEffectiveBranding) and passes it
 * here; with no provider every consumer gets the platform default, so a page
 * outside it never breaks.
 */
export function BrandingProvider({ value, children }: { value: Branding; children: ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}

/**
 * `term('leads', 'Leads')` → the tenant's word for it, else the fallback.
 * The fallback is the app's own copy, so default tenants (and e2e) see
 * exactly today's text.
 */
export function useTerm(): (key: BrandTermKey, fallback: string) => string {
  const { terms } = useBranding();
  return useCallback((key, fallback) => terms[key] ?? fallback, [terms]);
}

/** Display names for one product, with the app's defaults underneath. */
export function useProductName(product: BrandProductKey | undefined, fallback: string): string {
  const { productNames } = useBranding();
  return (product && productNames[product]?.title) || fallback;
}

/** Inline tenant term for JSX text: <Term k="leads" fallback="Leads" />. */
export function Term({ k, fallback }: { k: BrandTermKey; fallback: string }) {
  const term = useTerm();
  return <>{term(k, fallback)}</>;
}
