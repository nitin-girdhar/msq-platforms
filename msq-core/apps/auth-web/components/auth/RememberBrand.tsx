'use client';

import { useEffect } from 'react';
import { BRAND_KEY_COOKIE, isBrandKey } from '@platform/ui-kit/branding';

/**
 * Remembers the login link's brand key on this device, so the plain /login
 * (and forgot / reset pages) keep the tenant's look next time. Display only —
 * a first-party, non-sensitive cookie; sign-in never reads it.
 */
export default function RememberBrand({ brandKey }: { brandKey: string | null }) {
  useEffect(() => {
    if (!isBrandKey(brandKey)) return;
    try {
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${BRAND_KEY_COOKIE}=${brandKey}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    } catch {
      // Cookies blocked: the link still works, it just isn't remembered.
    }
  }, [brandKey]);
  return null;
}
