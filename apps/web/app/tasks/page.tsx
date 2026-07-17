import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import TasksShell from '@/components/tasks/TasksShell';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Ftasks');
  return <TasksShell actor={result.session} />;
}
