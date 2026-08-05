import { redirect } from 'next/navigation';
import { ANCHOR_RANK } from '@platform/rbac';
import { buildLoginUrl } from '@platform/ui-kit';
import { AppSidebar, MobileSidebar, HamburgerButton, UserMenu } from '@platform/ui-kit/shell';
import { getServerSession } from '@/src/lib/server-session';
import { ADMIN_NAV } from '@/src/config/navigation';
import LogoutButton from '@/components/auth/LogoutButton';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session } = result;

  // Rank floor for this whole console: org_admin and above. Unlike
  // lookup-admin (super_admin-only, gated on ADMIN_LOOKUPS_MANAGE + rank),
  // there's no single capability that spans every screen here — each screen
  // gates its own nav visibility (see ADMIN_NAV) and each backend re-checks
  // its own rank/capability independently, so the layout only needs to keep
  // members and below out, not decide what they'd see once in.
  if (session.rank < ANCHOR_RANK.ORG_ADMIN) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Access restricted</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#64748B]">
            This console is available to org and tenant admin accounts only. You
            are signed in as <span className="font-medium text-[#0F172A]">{session.name || session.email}</span>,
            which does not have access.
          </p>
          <p className="mt-2 text-sm text-[#64748B]">
            Sign out and sign back in with an admin account to continue.
          </p>
          <div className="mt-6 flex justify-center">
            <LogoutButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-full lg:min-h-0 lg:overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3 sm:px-6">
        <HamburgerButton />
        <span className="text-base font-bold tracking-tight text-[#0F172A]">Admin</span>
        <div className="ml-auto flex items-center gap-3">
          <UserMenu user={session} loginUrl={buildLoginUrl()} />
        </div>
      </header>
      <MobileSidebar actor={session} items={ADMIN_NAV} />
      <div className="flex w-full flex-1 lg:min-h-0 lg:overflow-hidden">
        <AppSidebar actor={session} items={ADMIN_NAV} />
        <main className="flex w-full min-w-0 flex-1 flex-col lg:overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
