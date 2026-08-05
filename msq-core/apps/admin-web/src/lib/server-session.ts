// Re-export of the shared server session helper, so `@/src/lib/server-session`
// imports across this app resolve to the same code path every product app
// (and lookup-admin) runs on — RS256/HS256 alg selection, JWT_ALLOW_HS256
// cutover switch, licensedProducts on the session.
export { getServerSession, GATEWAY_URL, type ServerSession } from '@platform/ui-kit/server';
