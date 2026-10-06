import { redirect } from 'next/navigation';
import { canOpenLookupAdmin } from '@platform/rbac';
import { productOrigins, adminWebOrigin } from '@platform/ui-kit';
import { AppShell } from '@platform/ui-kit/shell';
import { getServerSession } from '@/src/lib/server-session';
import { ADMIN_NAV } from '@/src/config/navigation';
import LogoutButton from '@/components/auth/LogoutButton';

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
      <div className="flex min-h-screen items-center justify-center bg-surface-container-low px-6">
        <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface-container-lowest p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-on-surface">Access restricted</h1>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            Lookup Admin is available to super admin accounts only. You are signed
            in as <span className="font-medium text-on-surface">{session.name || session.email}</span>,
            which does not have access.
          </p>
          <p className="mt-2 text-sm text-on-surface-variant">
            Sign out and sign back in with a super admin account to continue.
          </p>
          <div className="mt-6 flex justify-center">
            <LogoutButton />
          </div>
        </div>
      </div>
    );
  }

  // No SA-only scope control: the navbar's standard tenant/branch switcher
  // (BranchSwitcher, the same one every tool renders) is the scope, and SA
  // pages read it through src/lib/tenant-scope.ts.

  // The shared navbar, not a hand-rolled one — the responsive rules
  // (product pills inline on sm+, full-width row on mobile) live there and
  // nowhere else. activeExtra="sa" gives the SA pill the current-page
  // highlight the products get on their own headers; Admin rides alongside
  // it only when that console would actually admit this user, which
  // AppNavbar asks canOpenAdminConsole() for. The title is still the only
  // thing on screen that says which of the two consoles you are in.
  return (
    <AppShell
      nav={ADMIN_NAV}
      productLine="Super Admin"
      productKey="sa"
      user={session}
      licensedProducts={licensedProducts}
      productOrigins={productOrigins()}
      activeExtra="sa"
      homeHref="/dashboard"
      title="Super Admin"
      adminWebUrl={adminWebOrigin()}
    >
      {children}
    </AppShell>
  );
}
