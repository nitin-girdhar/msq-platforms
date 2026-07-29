import { createProductMiddleware, adminOrigin } from '@platform/ui-kit/middleware';

// Lookup-admin (platform staff tooling). Now runs on the SAME shared factory as
// lms-web / hr-web / todo-web, replacing a ~90-line hand-rolled copy of
// createProductMiddleware + verify-edge that had drifted from both:
//
//   * it required JWT_SECRET unconditionally and returned a 500 when it was
//     absent, so this app could not run RS256-only — forcing the HS256 signing
//     secret into a frontend container, which is precisely what moving to an
//     asymmetric key is meant to avoid;
//   * it never picked up the shared verifier's JWT_ALLOW_HS256 cutover switch;
//   * every fix to the shared factory had to be remembered here separately.
//
// `/login` stays public and the local login page is retained as the SINGLE-HOST
// DEV fallback: with no NEXT_PUBLIC_AUTH_URL configured, the factory's bounce()
// falls back to a same-origin /login. In the split topology it redirects to the
// auth origin instead, and lookup-admin's own origin must be set in
// NEXT_PUBLIC_ADMIN_URL so auth's open-redirect guard (resolveCallback) accepts
// the return trip — without it, login would land staff on a product app.
//
// `selfOrigin` is NEXT_PUBLIC_ADMIN_URL — the origin the BROWSER reaches this app
// on. The container listens on 3001 and is published on 3005, and nextUrl reports
// the listening port, so the callbackUrl used to come back as
// http://localhost:3001/dashboard — the LMS origin. It passed auth's allowlist
// (both are ours) and dropped staff into the LMS after signing in.
export const middleware = createProductMiddleware({
  publicPaths: ['/login', '/change-password'],
  selfOrigin: adminOrigin(),
});

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*', '/login', '/change-password'],
};
