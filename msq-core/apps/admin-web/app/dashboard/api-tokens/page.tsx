import { redirect } from 'next/navigation';
import { can, CAPABILITY } from '@platform/rbac';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import type { ApiTokenRow } from '@/src/lib/api/client';
import LoadError from '@/components/team/LoadError';
import ApiTokensShell from '@/components/api-tokens/ApiTokensShell';

export const dynamic = 'force-dynamic';

export default async function ApiTokensPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session, cookieHeader } = result;

  if (!can(session, CAPABILITY.PLATFORM_API_TOKENS_VIEW)) {
    return <LoadError title="API Tokens" status={403} />;
  }

  // Server-side fetch — same pattern as app/dashboard/team/page.tsx. The
  // client-side `apiTokens` namespace in src/lib/api/client.ts (relative
  // /api/... + browser cookies) is for the Create/Rotate/Revoke modals only.
  const res = await fetch(`${GATEWAY_URL}/api-clients`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });

  if (!res.ok) {
    console.error(`[api-tokens] GET ${GATEWAY_URL}/api-clients failed: ${res.status} ${res.statusText}`);
    return <LoadError title="API Tokens" status={res.status} />;
  }

  const body = await res.json() as { data: ApiTokenRow[] };

  return <ApiTokensShell tokens={body.data} canManage={can(session, CAPABILITY.PLATFORM_API_TOKENS_MANAGE)} />;
}
