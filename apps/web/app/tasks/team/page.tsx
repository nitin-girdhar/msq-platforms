import { redirect } from 'next/navigation';
import { canViewTeamTasks } from '@crm/permissions';
import { getServerSession } from '@/src/lib/server-session';
import TeamTasksShell from '@/components/tasks/TeamTasksShell';

export const dynamic = 'force-dynamic';

export default async function TasksTeamPage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Ftasks%2Fteam');
  // Same rank gating the CRM UI uses — under-privileged users are sent to the
  // tasks dashboard rather than shown a 404 (matches app/leave/approvals).
  if (!canViewTeamTasks(result.session.rank)) redirect('/tasks');
  return <TeamTasksShell actor={result.session} />;
}
