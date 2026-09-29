import { NextResponse, type NextRequest } from 'next/server';
import { authCookieName } from '@platform/auth-constants';
import { verifySessionJwt } from './auth/verify-edge';
import { authOrigin, buildChangePasswordUrl, buildLoginUrl } from './auth/sso';

// Re-exported so an app's middleware.ts can resolve its own public origin for
// `selfOrigin` without importing the package root (React chrome) into the Edge
// bundle.
export { authOrigin, adminOrigin, adminWebOrigin, productOrigins } from './auth/sso';

// Reusable auth gate for a product web app (lms/hr/todo). Each app's
// `middleware.ts` is a one-liner over this factory. Behavior mirrors the
// original apps/web middleware but redirects unauthenticated users to the
// shared auth app instead of a local /login, and verifies RS256/HS256 via the
// shared edge verifier. Runs in the Edge runtime.
//
// The DB-backed session liveness + entitlement checks still happen downstream
// (identity-service /auth/me via requireSession, and the gateway's per-request
// entitlement gate). This middleware is the cheap first gate: valid cookie or
// bounce to login.

export interface ProductMiddlewareOptions {
  // Path prefixes that require a valid session. Defaults cover the product
  // dashboard + proxied API. Public assets and Next internals are excluded by
  // the app's `config.matcher`.
  protectedPrefixes?: string[];
  // Paths served by this app that must stay public (no auth). Login/change-
  // password live on the auth origin now, so this is usually empty.
  publicPaths?: string[];
  // This app's own BROWSER-FACING origin, e.g. http://localhost:3005. Used to
  // build the post-login callbackUrl.
  //
  // Without it the callback is built from `request.nextUrl`, which carries the
  // port the server LISTENS on — inside a container that is the internal port,
  // not the published one. lookup-admin listens on 3001 and is published on
  // 3005, so it sent auth `callbackUrl=http://localhost:3001/dashboard`: the
  // LMS origin, which passes auth's allowlist and silently landed admins in the
  // LMS after login. Empty/unset keeps the old nextUrl behavior (single-host
  // dev, where the two agree).
  selfOrigin?: string;
}

// Prefixes are APP-RELATIVE and must stay that way — do NOT add the product's
// basePath here.
//
// Verified empirically against next@15.5.20 rather than assumed, because both
// ways of getting this wrong are expensive: prefixing would leave every
// protected route UNAUTHENTICATED, and the reverse would 500 on every request.
//
//   * `request.nextUrl.pathname` arrives with the basePath ALREADY STRIPPED.
//     NextURL.analyze() runs getNextPathnameInfo(), which removes the prefix
//     from `pathname` and parks it on `nextUrl.basePath`. Observed:
//         GET /hrms/attendance        -> pathname '/attendance'  basePath '/hrms'
//         GET /hrms/api/leave/balance -> pathname '/api/leave/balance'
//         GET /hrms                   -> pathname '/'
//   * Each app's `config.matcher` is likewise authored WITHOUT the prefix:
//     getMiddlewareMatchers() prepends `nextConfig.basePath` at build time
//     (`/attendance/:path*` compiles to `^\/hrms...\/attendance...`). Writing
//     `/hrms/attendance/:path*` yourself yields `/hrms/hrms/...`, which matches
//     nothing — middleware silently never runs and the route is left open.
//
// `nextUrl.href` is the exception: its getter re-formats through
// formatPathname(), so the basePath IS present there. That is what makes the
// callbackUrl below come out right either way.
const DEFAULT_PROTECTED = ['/dashboard', '/api/'];

export function createProductMiddleware(options: ProductMiddlewareOptions = {}) {
  const protectedPrefixes = options.protectedPrefixes ?? DEFAULT_PROTECTED;
  const publicPaths = new Set(options.publicPaths ?? []);
  const selfOrigin = (options.selfOrigin ?? '').replace(/\/$/, '');

  return async function middleware(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;

    const isPublic = publicPaths.has(pathname) || pathname.startsWith('/api/auth/');
    const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));
    if (!isProtected || isPublic) {
      return NextResponse.next();
    }

    const token = request.cookies.get(authCookieName(process.env['AUTH_COOKIE_NAME']))?.value;
    const payload = token ? await verifySessionJwt(token) : null;

    if (!payload) {
      return bounce(request, pathname, selfOrigin);
    }

    // Force password change: send interactive traffic to the auth origin's
    // change-password screen; leave API calls to fail at the service layer.
    if (payload.force_password_change && !pathname.startsWith('/api/')) {
      // buildChangePasswordUrl() concatenates onto the auth BASE URL, which may
      // carry a path prefix (https://apps.app.com is auth's, /lms /hrms /todo
      // are the products'). `new URL('/change-password', base)` would drop that
      // prefix. Empty base = single-host dev → resolve against this request.
      const url = authOrigin()
        ? buildChangePasswordUrl()
        : new URL('/change-password', request.url).toString();
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  };
}

// Redirect to the shared auth app's login, preserving the full URL the user was
// trying to reach so login can return them here. A product switch needs no
// re-login: every app is now one origin under its own path prefix, so the
// host-only session cookie (path '/') is already present.
function bounce(request: NextRequest, pathname: string, selfOrigin: string): NextResponse {
  const isApiRoute = pathname.startsWith('/api/');
  if (isApiRoute) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Prefer the configured public origin: nextUrl reports the port this process
  // listens on, which is the container-internal one behind a port mapping.
  //
  // Both halves of this are basePath-correct, from opposite directions:
  // `selfOrigin` is this app's BASE URL and already carries the prefix
  // (`http://app.localhost/hrms`), while `path` has had it stripped
  // (`/attendance`) — so the two concatenate back to the full public URL. The
  // `nextUrl.href` fallback needs no help: its getter re-adds the prefix.
  const { pathname: path, search } = request.nextUrl;
  const callbackUrl = selfOrigin ? `${selfOrigin}${path}${search}` : request.nextUrl.href;
  if (authOrigin()) {
    // buildLoginUrl() concatenates onto the auth BASE URL rather than resolving
    // '/login' against it: the base may carry a path prefix, and a root-relative
    // `new URL('/login', base)` would silently discard it and bounce the user to
    // a /login this app does not serve.
    return NextResponse.redirect(buildLoginUrl(callbackUrl));
  }
  // Single-host dev fallback: same-origin /login with a path-only callback.
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(loginUrl);
}
