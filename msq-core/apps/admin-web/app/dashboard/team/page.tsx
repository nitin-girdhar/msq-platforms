import { redirect } from 'next/navigation';
import { TeamShell, canOpenTeam } from '@platform/team-web';
import { loadTeamData, type TeamScope } from '@platform/team-web/server';
import { getServerSession } from '@/src/lib/server-session';
import LoadError from '@/components/common/LoadError';

export const dynamic = 'force-dynamic';

const SCOPES: readonly TeamScope[] = ['reports', 'org', 'tenant'];

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session, cookieHeader } = result;

  // The capability, not a rank floor. The dashboard layout no longer keeps
  // non-admins out of the console — it asks whether they have any screen here at
  // all — so each page owns its own gate, and this one is the same predicate
  // ADMIN_NAV uses for the sidebar entry. A link that appears must open.
  if (!canOpenTeam(session)) {
    return <LoadError title="Team" status={403} />;
  }

  // Validated here only to avoid forwarding junk; it is NOT the authority.
  // identity-service re-derives the scope from the actor's admin.team.view.*
  // rung and silently narrows anything they may not use, so a hand-typed
  // ?scope=tenant buys nothing.
  const { scope: raw } = await searchParams;
  const requested = SCOPES.find((v) => v === raw);

  const data = await loadTeamData(cookieHeader, requested);
  if (!data.ok) {
    return <LoadError title="Team" status={data.status} />;
  }

  return (
    <TeamShell
      users={data.users}
      actor={session}
      total={data.total}
      orgs={data.orgs}
      myOrgs={data.myOrgs}
      branchesFailed={data.branchesFailed}
      scope={data.scope}
    />
  );
}
