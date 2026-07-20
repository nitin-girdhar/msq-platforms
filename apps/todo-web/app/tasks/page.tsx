import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { TasksShell } from '@task/web';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  return <TasksShell actor={result.session} />;
}
