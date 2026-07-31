import { redirect } from 'next/navigation';
import { can, CAPABILITY, ANCHOR_RANK } from '@platform/rbac';
import { AppSidebar, MobileSidebar, HamburgerButton, UserMenu } from '@platform/ui-kit/shell';
import { getServerSession } from '@/src/lib/server-session';
import { fetchTenants, getSelectedTenantId } from '@/src/lib/tenant-scope';
import { ADMIN_NAV } from '@/src/config/navigation';
import LogoutButton from '@/components/auth/LogoutButton';
import TenantScopeSwitcher from '@/components/shell/TenantScopeSwitcher';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session } = result;
  // Authenticated but not granted: render a clean denial in place instead of
  // redirecting to /login. The old redirect looped forever — the login page saw
  // a valid session and bounced straight back here (see login/page.tsx).
  //
  // Tier C3: the gate is the admin.lookups.manage capability AND the super_admin
  // rank. BOTH, deliberately — this is not belt-and-braces.
  //
  // The rank floor is what admin-service actually enforces: every route behind
  // this console re-checks `rank >= RANKS.SUPER_ADMIN` on its own (see
  // capabilities.controller.ts), independently of any capability. So the
  // capability alone was never sufficient to make the console WORK — it was only
  // sufficient to make it OPEN.
  //
  // That gap was reachable by accident. The Capability Matrix screen renders the
  // whole catalog for whichever role is selected, `admin` subtree included, so
  // ticking `admin` + `admin.lookups.manage` onto (say) a sales role let its
  // users through this door and into a console where every data call 403s on
  // rank — the render-then-403 shape the capability tree exists to remove, this
  // time produced by the admin UI itself. Matching the server's floor here means
  // a mis-tick grants nothing rather than a broken console.
  //
  // To genuinely widen this console to a lower rank, relax admin-service's rank
  // check to the capability first, then relax this one. Changing either alone
  // just moves where the 403 lands.
  if (!can(session, CAPABILITY.ADMIN_LOOKUPS_MANAGE) || session.rank < ANCHOR_RANK.SUPER_ADMIN) {
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

  // One tenant scope for the whole admin app, chosen here in the navbar. Pages
  // below read it from the cookie (getSelectedTenantId) rather than each one
  // rendering its own selector.
  const [tenants, selectedTenantId] = await Promise.all([
    fetchTenants(result.cookieHeader),
    getSelectedTenantId(),
  ]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-full lg:min-h-0 lg:overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3 sm:px-6">
        <HamburgerButton />
        <span className="text-base font-bold tracking-tight text-[#0F172A]">Admin</span>
        <div className="ml-auto flex items-center gap-3">
          <TenantScopeSwitcher tenants={tenants} selectedTenantId={selectedTenantId} />
          <UserMenu user={session} />
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
