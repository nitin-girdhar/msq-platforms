import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { canViewTeamTasks } from '@task/authz';
import { getServerSession } from '@platform/ui-kit/server';
import { TeamTasksShell } from '@task/web';

export const dynamic = 'force-dynamic';

export default async function TasksTeamPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Same rank gating the CRM UI uses — under-privileged users are sent to the
  // tasks dashboard rather than shown a 404 (matches app/leave/approvals).
  if (!canViewTeamTasks(result.session.rank)) redirect('/tasks');
  return <TeamTasksShell actor={result.session} />;
}
