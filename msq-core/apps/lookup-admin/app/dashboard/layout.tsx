import { redirect } from 'next/navigation';
import { canOpenAdminConsole, canOpenLookupAdmin } from '@platform/rbac';
import { buildLoginUrl, buildChangePasswordUrl, productOrigins, adminWebOrigin } from '@platform/ui-kit';
import { AppSidebar, MobileSidebar, HamburgerButton, ProductSwitcher, UserMenu } from '@platform/ui-kit/shell';
import { getServerSession } from '@/src/lib/server-session';
import { fetchTenants, fetchOrgs, getSelectedTenantId, getSelectedOrgId } from '@/src/lib/tenant-scope';
import { ADMIN_NAV } from '@/src/config/navigation';
import LogoutButton from '@/components/auth/LogoutButton';
import TenantScopeSwitcher from '@/components/shell/TenantScopeSwitcher';
import OrgScopeSwitcher from '@/components/shell/OrgScopeSwitcher';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session, licensedProducts } = result;
  // Authenticated but not granted: render a clean denial in place instead of
  // redirecting to /login. The old redirect looped forever — the login page saw
  // a valid session and bounced straight back here (see login/page.tsx).
  //
  // Tier C3: the gate is the admin.lookups.manage capability AND the super_admin
  // rank. BOTH, deliberately — see canOpenLookupAdmin() for why, and why
  // relaxing either one alone only moves where the 403 lands.
  //
  // Inlined here until the SA pill needed the same answer. It now lives in
  // @platform/rbac so this guard and every pill linking to this console ask one
  // question: a pill that could appear for someone this page then refuses is the
  // render-then-403 shape the capability tree exists to remove.
  if (!canOpenLookupAdmin(session)) {
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
  // rendering its own selector. The org scope is the same shape one level
  // down, for `scope: 'org'` tables — always rendered in chrome (not
  // conditioned on the current page) for the same reason the tenant switcher
  // is: pages that don't need it simply ignore it.
  const [tenants, selectedTenantId, orgs, selectedOrgId] = await Promise.all([
    fetchTenants(result.cookieHeader),
    getSelectedTenantId(),
    fetchOrgs(result.cookieHeader),
    getSelectedOrgId(),
  ]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-full lg:min-h-0 lg:overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3 sm:px-6">
        <HamburgerButton />
        {/* "Super Admin", not "Admin": admin-web's header renders the identical
            span with the identical styling, so the two consoles were
            indistinguishable at a glance — and now that the SA and Admin pills
            sit side by side in the switcher, you can land on either in one
            click. The title is the only thing on screen that says which one
            you're in. */}
        <span className="text-base font-bold tracking-tight text-[#0F172A]">Super Admin</span>
        <div className="ml-auto flex items-center gap-3">
          {/* No activeProduct: lookup-admin isn't a licensed product, so every
              LMS/HR/Task link here is cross-origin back out. SA rides in as an
              active extraLink to get the same "current page" highlight the
              products get on their own headers — the identical arrangement
              admin-web uses for its own Admin pill. Admin is shown alongside it
              only when that console would actually admit this user. */}
          <ProductSwitcher
            licensedProducts={licensedProducts}
            actor={session}
            origins={productOrigins()}
            extraLinks={[
              ...(adminWebOrigin() && canOpenAdminConsole(session)
                ? [{ key: 'admin', href: adminWebOrigin(), label: 'Admin' }]
                : []),
              { key: 'sa', href: '/dashboard', label: 'SA', active: true },
            ]}
          />
          <TenantScopeSwitcher tenants={tenants} selectedTenantId={selectedTenantId} />
          <OrgScopeSwitcher orgs={orgs} selectedTenantId={selectedTenantId} selectedOrgId={selectedOrgId} />
          <UserMenu user={session} loginUrl={buildLoginUrl()} changePasswordUrl={buildChangePasswordUrl()} />
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
