import { redirect } from 'next/navigation';
import { can, CAPABILITY } from '@platform/rbac';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import type { ApiTokenRow } from '@/src/lib/api/client';
import LoadError from '@/components/team/LoadError';
import ApiTokensShell from '@/components/api-tokens/ApiTokensShell';

export const dynamic = 'force-dynamic';

interface OrgOption {
  id: string;
  name: string;
}

export default async function ApiTokensPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session, cookieHeader } = result;

  if (!can(session, CAPABILITY.PLATFORM_API_TOKENS_VIEW)) {
    return <LoadError title="API Tokens" status={403} />;
  }

  // Server-side fetch — same pattern as app/dashboard/team/page.tsx. The
  // client-side `apiTokens` namespace in src/lib/api/client.ts (relative
  // /api/... + browser cookies) is for the Create/Edit/Rotate/Revoke modals only.
  const [tokensRes, orgsRes] = await Promise.all([
    fetch(`${GATEWAY_URL}/api-clients`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
    fetch(`${GATEWAY_URL}/orgs/all`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
  ]);

  if (!tokensRes.ok) {
    console.error(`[api-tokens] GET ${GATEWAY_URL}/api-clients failed: ${tokensRes.status} ${tokensRes.statusText}`);
    return <LoadError title="API Tokens" status={tokensRes.status} />;
  }

  const body = await tokensRes.json() as { data: ApiTokenRow[] };

  let orgs: OrgOption[] = [];
  if (orgsRes.ok) {
    const orgsBody = await orgsRes.json() as { data?: Array<{ id: string; name: string }> };
    orgs = Array.isArray(orgsBody.data) ? orgsBody.data.map((o) => ({ id: o.id, name: o.name })) : [];
  }

  return (
    <ApiTokensShell
      tokens={body.data}
      orgs={orgs}
      actor={session}
      canManage={can(session, CAPABILITY.PLATFORM_API_TOKENS_MANAGE)}
    />
  );
}
