import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import { canManageAttendanceAdmin } from '@/src/lib/attendance/format';
import AttendanceAdminShell from '@/components/attendance/AttendanceAdminShell';

export const dynamic = 'force-dynamic';

export default async function AttendanceAdminPage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Fattendance%2Fadmin');
  // hr_admin / org_admin only — everyone else lands on the attendance dashboard.
  if (!canManageAttendanceAdmin(result.session.role, result.session.rank)) redirect('/attendance');
  return <AttendanceAdminShell actor={result.session} />;
}
