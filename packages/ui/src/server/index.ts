// @platform/ui-kit/server — server-only entry point. Everything reachable from
// here runs exclusively in Server Components / route handlers (it pulls in
// `next/headers`, `next/navigation`, and `jose`) and must never be imported
// from a 'use client' module. Kept behind the `./server` export so this code
// is never bundled into the browser build.

export { getServerSession, GATEWAY_URL } from './server-session';
export { requireSession, type AuthenticatedSession } from './require-session';
export { getEnabledModules, type PlatformModule } from './modules';
