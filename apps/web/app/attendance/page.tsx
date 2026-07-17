import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import AttendanceDashboardShell from '@/components/attendance/AttendanceDashboardShell';

export const dynamic = 'force-dynamic';

export default async function AttendancePage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Fattendance');
  return <AttendanceDashboardShell actor={result.session} />;
}
