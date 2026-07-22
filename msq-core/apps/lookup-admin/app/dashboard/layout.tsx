import { redirect } from 'next/navigation';
import { RANKS } from '@platform/authz';
import { getServerSession } from '@/src/lib/server-session';
import LogoutButton from '@/components/auth/LogoutButton';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session } = result;
  // Authenticated but under-ranked: render a clean denial in place instead of
  // redirecting to /login. The old redirect looped forever — the login page saw
  // a valid session and bounced straight back here (see login/page.tsx). A
  // signed-in super-admin is required; offer logout to switch accounts.
  if (session.rank < RANKS.SUPER_ADMIN) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Access restricted</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#64748B]">
            Lookup Admin is available to super admin accounts only. You are signed
            in as <span className="font-medium text-[#0F172A]">{session.name || session.email}</span>,
            which does not have access.
          </p>
          <p className="mt-2 text-sm text-[#64748B]">
            Sign out and sign back in with a super admin account to continue.
          </p>
          <div className="mt-6 flex justify-center">
            <LogoutButton />
          </div>
        </div>
      </div>
    );
  }

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
