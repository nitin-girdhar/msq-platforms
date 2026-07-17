import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import LeaveDashboardShell from '@/components/leave/LeaveDashboardShell';

export const dynamic = 'force-dynamic';

export default async function LeavePage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Fleave');
  return <LeaveDashboardShell actor={result.session} />;
}
