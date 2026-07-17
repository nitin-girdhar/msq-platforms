import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import { canManageLeaveAdmin } from '@/src/lib/leave/format';
import LeaveAdminShell from '@/components/leave/LeaveAdminShell';

export const dynamic = 'force-dynamic';

export default async function LeaveAdminPage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Fleave%2Fadmin');
  // hr_admin / org_admin only — everyone else lands on the leave dashboard.
  if (!canManageLeaveAdmin(result.session.role, result.session.rank)) redirect('/leave');
  return <LeaveAdminShell actor={result.session} />;
}
