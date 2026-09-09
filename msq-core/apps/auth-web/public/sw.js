/*
 * FitClass platform service worker — served at /sw.js, scope '/'.
 *
 * ONE worker for all six Next apps behind the unified origin (auth-web at '/',
 * products under /lms, /hrms, /todo, /admin, /sa).
 * See docs/Architecture.md → Web push & PWA.
 *
 * WHY THIS IS HAND-WRITTEN, AND MUST STAY THAT WAY
 *
 * Do not replace this with `@serwist/next` or `next-pwa`. Both generate a
 * PER-APP precache manifest at build time. With six Next apps behind a single
 * origin that produces six service workers all claiming scope '/', each
 * overwriting the others' registration and each precaching only its own
 * build's assets. What this platform actually needs is "install + fast shell +
 * push", and runtime caching covers all three with no build integration at
 * all. Keep it plain JS in auth-web's public/ so exactly one worker exists.
 *
 * SECURITY: no API response is ever written to a cache. See the first check in
 * the fetch handler.
 */

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

// BUMP THIS ON EVERY DEPLOY. Browsers cache /sw.js aggressively; without a byte
// change in this file the browser keeps running the previously installed worker
// and serving assets out of its old caches. This is the most common way a PWA
// deploy fails quietly. It is on the release checklist in
// msq-deploy/deploy_linux.md under "Release checklist for PWA deployments".
const SW_VERSION = 'v2';

const STATIC_CACHE = `fc-static-${SW_VERSION}`;
const SHELL_CACHE = `fc-shell-${SW_VERSION}`;
const OWNED_CACHES = [STATIC_CACHE, SHELL_CACHE];

// Navigation fallback: a minimal auth-web route carrying no session data —
// see app/offline/page.tsx.
const OFFLINE_URL = '/offline';

const PUSH_SUBSCRIBE_URL = '/api/notifications/push/subscribe';

// ---------------------------------------------------------------------------
// Install / activate
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        // `cache: 'reload'` so the offline shell comes from the network rather
        // than an HTTP cache that may still hold the previous build.
        await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      } catch (err) {
        // A failing /offline must not block installation — the worker is still
        // worth having for push and static caching.
        console.debug('[sw] offline shell precache failed', err);
      }

      // Take over as soon as installed rather than waiting for every tab to
      // close. Combined with clients.claim() below this can hand an
      // already-open page assets produced by a newer build; that is safe here
      // because the only cache-first rule covering build output is
      // */_next/static/*, whose filenames are content hashes — a page can never
      // receive a *different* file under a name it already asked for.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache that does not carry the current SW_VERSION.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('fc-') && !OWNED_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Any call destined for the API gateway.
 *
 * Matches an `api` path segment anywhere, not only a leading `/api/`: product
 * apps are compiled with a basePath and reach their own proxy route through
 * `withBasePath()`, so the same call appears as `/lms/api/leads`,
 * `/hrms/api/attendance`, … as well as auth-web's root `/api/*`.
 */
function isApiRequest(url) {
  return /(^|\/)api(\/|$)/.test(url.pathname);
}

/**
 * Build output: `/lms/_next/static/...`, `/hrms/_next/static/...` and
 * auth-web's own `/_next/static/...`. Matched on the `_next/static` segment
 * rather than a leading `/_next` precisely because of the product prefixes.
 */
function isImmutableBuildAsset(url) {
  return url.pathname.includes('/_next/static/');
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/icons/') ||
    /\.(?:webp|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|otf)$/i.test(url.pathname)
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Only store a real, complete same-origin response. An opaque or error
  // response would poison the cache for the lifetime of this SW_VERSION.
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // SECURITY — FIRST CHECK, EXPLICIT EARLY RETURN, NO CACHE LOOKUP.
  //
  // /api/* and every gateway call is network-only: never cached, never stored.
  // Caching an API response writes tenant data to device storage that survives
  // logout and outlives the session — a direct violation of "no possibility of
  // data leakage across tenant" in .claude/CLAUDE.md. This is a security
  // requirement, not a performance choice, so it is enforced here rather than
  // being left to fall through to the network-only default at the bottom.
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (isApiRequest(url)) return;

  // Everything below deals only with same-origin GETs.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (isImmutableBuildAsset(url) || isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Default: network-only. Not calling respondWith leaves it to the browser.
});

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      // Payload shape is set by the notifications service:
      // { title, body, url, leadId }.
      let payload = null;
      try {
        payload = event.data ? event.data.json() : null;
      } catch (err) {
        console.debug('[sw] push payload was not JSON', err);
      }

      // A malformed payload must still surface something. Showing nothing is
      // invisible to everyone: the user sees no notification and the server
      // sees a successful delivery.
      const title = (payload && payload.title) || 'FitClass';
      const body = (payload && payload.body) || 'You have a follow-up due.';
      const url = (payload && payload.url) || '/';

      await self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url },
        // Keyed on the lead so a re-notification for the SAME lead replaces the
        // existing one instead of stacking. A rep with a tab open also receives
        // the SSE notification; without this the phone shows a growing pile for
        // a single follow-up.
        tag: (payload && payload.leadId) || 'fitclass-followup',
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          // Let the app navigate client-side. Reloading the document would
          // throw away in-flight work in an already-open window.
          client.postMessage({ type: 'notification-click', url: target });
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(target);
      }
    })(),
  );
});

/*
 * Browsers rotate push subscriptions on their own — no user action, no error,
 * no signal anywhere in the system. Without this handler push delivery simply
 * stops, and the only symptom is notifications quietly never arriving again.
 * It is the most commonly omitted push handler and the hardest failure to
 * diagnose after the fact.
 *
 * The subscribe endpoint does not exist yet (step 7). Failures here are
 * deliberately non-fatal: there is nothing useful the worker can do about them,
 * and the client reconciles its subscription on next launch (step 8).
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Re-subscribe with the SAME application server key. Anything else
        // yields a subscription the server's VAPID keys cannot push to.
        const applicationServerKey =
          (event.oldSubscription &&
            event.oldSubscription.options &&
            event.oldSubscription.options.applicationServerKey) ||
          (event.newSubscription &&
            event.newSubscription.options &&
            event.newSubscription.options.applicationServerKey) ||
          null;

        if (!applicationServerKey) return;

        const subscription =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }));

        await fetch(PUSH_SUBSCRIBE_URL, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription),
        });
      } catch (err) {
        console.debug('[sw] re-subscribe after pushsubscriptionchange failed', err);
      }
    })(),
  );
});
