import { createProductMiddleware, adminWebOrigin } from '@platform/ui-kit/middleware';

// admin-web (org_admin/tenant_admin console: Team, API Tokens, Leave/Attendance
// admin). Runs on the same shared middleware factory as every other product app
// — see lookup-admin/middleware.ts for the history of why a hand-rolled copy is
// the wrong move here (drifts from JWT_ALLOW_HS256 cutover, RS256 support, etc).
//
// `selfOrigin` must be this app's OWN origin (NEXT_PUBLIC_ADMIN_WEB_URL), not the
// port Next happens to listen on internally — see lookup-admin's port-mismatch
// history for why that distinction matters for the post-login callback.
export const middleware = createProductMiddleware({
  publicPaths: ['/login', '/change-password'],
  selfOrigin: adminWebOrigin(),
});

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*', '/login', '/change-password'],
};
