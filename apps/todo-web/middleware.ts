import { createProductMiddleware } from '@platform/ui-kit/middleware';

// Task product app (todo.app.com). Verifies the shared .app.com session cookie
// and bounces unauthenticated users to the auth origin, preserving the target.
export const middleware = createProductMiddleware({
  protectedPrefixes: ['/tasks', '/api/'],
});

export const config = {
  matcher: ['/tasks/:path*', '/api/:path*'],
};
