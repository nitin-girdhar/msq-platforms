import { redirect } from 'next/navigation';
import { buildLoginUrl } from '@platform/ui-kit';
import { getServerSession } from '@platform/ui-kit/server';
import { canManageLeaveAdmin, getHrRank, LeaveAdminShell } from '@hr/web';

export const dynamic = 'force-dynamic';

export default async function LeaveAdminPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());
  // Tier C3: gated on the hr.leave.admin capability — the same grant
  // hr-service checks — so this page and its calls can never disagree.
  // Redirects to /dashboard rather than hr-web's /leave: admin-web has no
  // employee self-service Leave screen to fall back to.
  if (!canManageLeaveAdmin(result.session)) redirect('/dashboard');
  const hrRank = await getHrRank(result.cookieHeader);
  return <LeaveAdminShell actor={result.session} hrRank={hrRank} />;
}
