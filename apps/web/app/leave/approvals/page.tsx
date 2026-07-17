import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import { canViewLeaveApprovals } from '@/src/lib/leave/format';
import LeaveApprovalsShell from '@/components/leave/LeaveApprovalsShell';

export const dynamic = 'force-dynamic';

export default async function LeaveApprovalsPage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Fleave%2Fapprovals');
  // Same rank/role gating the CRM UI uses — under-privileged users are sent to
  // the leave dashboard rather than shown a 404 (matches app/dashboard/team).
  if (!canViewLeaveApprovals(result.session.rank)) redirect('/leave');
  return <LeaveApprovalsShell actor={result.session} />;
}
