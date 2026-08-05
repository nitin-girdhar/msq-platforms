import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canManageAttendanceAdmin, AttendanceAdminShell, getHrRank } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function AttendanceAdminPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Tier C3: gated on the hr.attendance.admin capability — the same grant
  // hr-service checks — so this page and its calls can never disagree.
  // Redirects to /dashboard rather than hr-web's /attendance: admin-web has no
  // employee self-service Attendance screen to fall back to.
  if (!canManageAttendanceAdmin(result.session)) redirect('/dashboard');
  const hrRank = await getHrRank(result.cookieHeader);
  return <AttendanceAdminShell actor={result.session} hrRank={hrRank} />;
}
