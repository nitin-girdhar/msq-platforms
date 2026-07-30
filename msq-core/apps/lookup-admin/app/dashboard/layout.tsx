import { redirect } from 'next/navigation';
import { can, CAPABILITY } from '@platform/rbac';
import { AppSidebar, MobileSidebar, HamburgerButton, UserMenu } from '@platform/ui-kit/shell';
import { getServerSession } from '@/src/lib/server-session';
import { fetchTenants, getSelectedTenantId } from '@/src/lib/tenant-scope';
import { ADMIN_NAV } from '@/src/config/navigation';
import LogoutButton from '@/components/auth/LogoutButton';
import TenantScopeProvider from '@/components/tenant/TenantScopeProvider';
import TenantScopeSelector from '@/components/tenant/TenantScopeSelector';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session } = result;
  // Authenticated but not granted: render a clean denial in place instead of
  // redirecting to /login. The old redirect looped forever — the login page saw
  // a valid session and bounced straight back here (see login/page.tsx).
  //
  // Tier C3: the gate is the admin.lookups.manage capability. Shipped to
  // super_admin only, but a deployment can now widen it as data.
  if (!can(session, CAPABILITY.ADMIN_LOOKUPS_MANAGE)) {
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

  // The tenant list and the current selection are resolved ONCE here, for every
  // page under /dashboard. Previously each tenant-scoped page fetched
  // /lookups/tenants itself just to render its own dropdown; now the selector
  // lives in the header and the choice (a cookie) flows down through context.
  const [tenants, selectedTenantId] = await Promise.all([
    fetchTenants(result.cookieHeader),
    getSelectedTenantId(),
  ]);

  return (
    <TenantScopeProvider tenants={tenants} selectedTenantId={selectedTenantId}>
      <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-full lg:min-h-0 lg:overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3 sm:px-6">
          <HamburgerButton />
          <span className="text-base font-bold tracking-tight text-[#0F172A]">Admin</span>
          <div className="ml-auto flex items-center gap-4">
            <TenantScopeSelector tenants={tenants} selectedTenantId={selectedTenantId} />
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
    </TenantScopeProvider>
  );
}
