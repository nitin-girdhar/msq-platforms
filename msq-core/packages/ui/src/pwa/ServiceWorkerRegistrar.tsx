'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js at scope '/' on mount. Renders nothing.
 *
 * Mounted in all six root layouts, not just auth-web's: a user can deep-link
 * straight into a product (e.g. /hrms/attendance) and must still get the
 * worker, since the service worker's scope — and the push subscription it
 * carries — is the single shared origin, not any one product.
 *
 * /sw.js lives in auth-web's public/ (it owns the root origin). Registration
 * can still fail — an insecure origin in some dev setups, or a browser with
 * service workers disabled — and must stay silent rather than break the page.
 */
export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      // eslint-disable-next-line no-console
      console.debug('[pwa] service worker registration failed', err);
    });
  }, []);

  return null;
}
