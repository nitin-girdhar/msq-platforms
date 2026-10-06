'use client';

import { useMemo } from 'react';
import { useBranding } from '../branding/BrandingProvider';
import { createFormatters, type Formatters } from './format';

/**
 * The signed-in tenant's regional formats as ready-to-use formatters. Replaces
 * every ad-hoc `toLocale*` / `Intl.*` call in screens:
 *   const { formatDate, formatMoney } = useLocale();
 * Memoised per config, so the object is stable across renders.
 */
export function useLocale(): Formatters {
  const { locale } = useBranding();
  return useMemo(() => createFormatters(locale), [locale]);
}
