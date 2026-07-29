// Re-export of the shared server session helper, so existing
// `@/src/lib/server-session` imports across this app keep working unchanged.
//
// This file previously held its own copy, which had drifted in a way that would
// have broken silently on the RS256 rollout: it hardcoded `algorithms: ['HS256']`
// and threw outright when JWT_SECRET was absent. Once tokens are signed RS256,
// every lookup-admin server component would have resolved a null session and
// bounced staff to login with no visible cause.
//
// The shared helper selects RS256 or HS256 from the token's own alg header (and
// honours the JWT_ALLOW_HS256 cutover switch), returns `licensedProducts`
// alongside the session, and is the same code path the product apps run on.
export { getServerSession, GATEWAY_URL, type ServerSession } from '@platform/ui-kit/server';
