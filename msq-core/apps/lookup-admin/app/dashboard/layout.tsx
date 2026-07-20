import { redirect } from 'next/navigation';
import { RANKS } from '@platform/authz';
import { getServerSession } from '@/src/lib/server-session';
import LogoutButton from '@/components/auth/LogoutButton';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session } = result;
  if (session.rank < RANKS.SUPER_ADMIN) redirect('/login?error=forbidden');

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="flex items-center justify-between border-b border-[#E2E8F0] bg-white px-4 py-3 sm:px-6">
        <span className="text-base font-bold tracking-tight text-[#0F172A]">Lookup Admin</span>
        <div className="flex items-center gap-4">
          <span className="text-xs text-[#64748B]">
            {session.name || session.email}
          </span>
          <LogoutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
