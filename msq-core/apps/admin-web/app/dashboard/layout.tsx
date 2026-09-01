import { redirect } from 'next/navigation';
import { buildLoginUrl, buildChangePasswordUrl, productOrigins } from '@platform/ui-kit';
import { AppSidebar, MobileSidebar, HamburgerButton, ProductSwitcher, UserMenu, BranchSwitcher, filterNavGroups } from '@platform/ui-kit/shell';
import { getServerSession } from '@/src/lib/server-session';
import { ADMIN_NAV } from '@/src/config/navigation';
import LogoutButton from '@/components/auth/LogoutButton';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session, licensedProducts } = result;

  // Access to this console is CAPABILITY-driven, not rank-driven: you may open it
  // if any screen in it is reachable for you. There is deliberately no single
  // capability spanning the console — each screen owns its own page node under
  // the `admin` tool (see ADMIN_NAV) and each backend re-checks independently —
  // so "has at least one nav item" is the honest question, and filterNavGroups
  // already answers it.
  //
  // This replaced a `rank < ORG_ADMIN` floor. That floor pre-dated Team having a
  // real capability, and it locked out exactly the people the team-scoped roster
  // exists for: a senior_sales_executive granted admin.team.view.team could hold
  // the capability and still never reach the screen.
  //
  // Filtered once here and passed down, rather than recomputed inside each of
  // AppSidebar/MobileSidebar — the guard and the rail must agree on what is
  // visible, and computing it twice is how they drift apart.
  const navGroups = filterNavGroups(ADMIN_NAV, session);

  if (navGroups.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Access restricted</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#64748B]">
            You are signed in as <span className="font-medium text-[#0F172A]">{session.name || session.email}</span>,
            which has no admin screens enabled.
          </p>
          <p className="mt-2 text-sm text-[#64748B]">
            Ask an administrator to grant you access, or sign back in with a different account.
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
          {/* Branch pill before the product tabs, matching AppNavbar's order.
              The console is server-rendered per request (force-dynamic +
              getServerSession), so switching branch re-mints the session cookie
              and the full reload rebuilds the sidebar and every screen (Team,
              API Tokens, HR admin) for the selected branch. Self-hides for
              single-branch and non-switching actors. */}
          <BranchSwitcher user={session} homeHref="/dashboard" />
          {/* No activeProduct: admin-web isn't a licensed product itself, so
              every LMS/HR/Task link here is cross-origin back out. The Admin
              pill itself is passed as an active extraLink instead, so it gets
              the same "current page" highlight LMS/HR/Task get on their own
              headers. */}
          <ProductSwitcher
            licensedProducts={licensedProducts}
            actor={session}
            origins={productOrigins()}
            extraLinks={[{ key: 'admin', href: '/dashboard', label: 'Admin', active: true }]}
          />
          <UserMenu user={session} loginUrl={buildLoginUrl()} changePasswordUrl={buildChangePasswordUrl()} />
        </div>
      </header>
      <MobileSidebar actor={session} items={navGroups} />
      <div className="flex w-full flex-1 lg:min-h-0 lg:overflow-hidden">
        <AppSidebar actor={session} items={navGroups} />
        <main className="flex w-full min-w-0 flex-1 flex-col lg:overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
