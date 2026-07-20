import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@crm/auth-constants';
import { verifySessionJwt } from './auth/verify-edge';
import { authOrigin } from './auth/sso';

// Reusable auth gate for a product web app (lms/hr/todo). Each app's
// `middleware.ts` is a one-liner over this factory. Behavior mirrors the
// original apps/web middleware but redirects unauthenticated users to the
// shared auth origin (auth.app.com) instead of a local /login, and verifies
// RS256/HS256 via the shared edge verifier. Runs in the Edge runtime.
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
}

const DEFAULT_PROTECTED = ['/dashboard', '/api/'];

export function createProductMiddleware(options: ProductMiddlewareOptions = {}) {
  const protectedPrefixes = options.protectedPrefixes ?? DEFAULT_PROTECTED;
  const publicPaths = new Set(options.publicPaths ?? []);

  return async function middleware(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;

    const isPublic = publicPaths.has(pathname) || pathname.startsWith('/api/auth/');
    const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));
    if (!isProtected || isPublic) {
      return NextResponse.next();
    }

    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    const payload = token ? await verifySessionJwt(token) : null;

    if (!payload) {
      return bounce(request, pathname);
    }

    // Force password change: send interactive traffic to the auth origin's
    // change-password screen; leave API calls to fail at the service layer.
    if (payload.force_password_change && !pathname.startsWith('/api/')) {
      const origin = authOrigin();
      const url = origin ? `${origin}/change-password` : new URL('/change-password', request.url).toString();
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  };
}

// Redirect to the shared auth origin's login, preserving the full URL the user
// was trying to reach so login can return them here (no re-login when they
// arrived via a product switch — the cookie is already shared on .app.com).
function bounce(request: NextRequest, pathname: string): NextResponse {
  const isApiRoute = pathname.startsWith('/api/');
  if (isApiRoute) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const origin = authOrigin();
  const callbackUrl = request.nextUrl.href;
  if (origin) {
    const loginUrl = new URL('/login', origin);
    loginUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(loginUrl);
  }
  // Single-host dev fallback: same-origin /login with a path-only callback.
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(loginUrl);
}
