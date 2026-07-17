import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import { canViewAttendanceTeam } from '@/src/lib/attendance/format';
import AttendanceTeamShell from '@/components/attendance/AttendanceTeamShell';

export const dynamic = 'force-dynamic';

export default async function AttendanceTeamPage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Fattendance%2Fteam');
  // Same rank/role gating the CRM UI uses — under-privileged users are sent to
  // the attendance dashboard rather than shown a 404 (matches app/leave/approvals).
  if (!canViewAttendanceTeam(result.session.rank)) redirect('/attendance');
  return <AttendanceTeamShell actor={result.session} />;
}
