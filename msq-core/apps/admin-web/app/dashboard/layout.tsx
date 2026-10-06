import { redirect } from 'next/navigation';
import { productOrigins, adminOrigin } from '@platform/ui-kit';
import { filterNavGroups, AppShell } from '@platform/ui-kit/shell';
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
      <div className="flex min-h-screen items-center justify-center bg-surface-container-low px-6">
        <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface-container-lowest p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-on-surface">Access restricted</h1>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            You are signed in as <span className="font-medium text-on-surface">{session.name || session.email}</span>,
            which has no admin screens enabled.
          </p>
          <p className="mt-2 text-sm text-on-surface-variant">
            Ask an administrator to grant you access, or sign back in with a different account.
          </p>
          <div className="mt-6 flex justify-center">
            <LogoutButton />
          </div>
        </div>
      </div>
    );
  }

  // The shared navbar, not a hand-rolled one: it is the only place the
  // responsive rules live (product pills inline on sm+, full-width row on
  // mobile), and this console's own copy of that header used to squeeze
  // the pills off-screen on a phone. activeExtra marks the Admin pill as
  // the current page — this console is capability-gated chrome, not a
  // licensed product, so it can never be the activeProduct. The SA pill
  // rides along on lookup-admin's own guard predicate, hidden outright
  // when ADMIN_URL is unset (single-host dev with no /sa deployed).
  return (
    <AppShell
      nav={navGroups}
      productLine="Admin Console"
      productKey="admin"
      user={session}
      licensedProducts={licensedProducts}
      productOrigins={productOrigins()}
      activeExtra="admin"
      homeHref="/dashboard"
      title="Admin"
      lookupAdminUrl={adminOrigin()}
    >
      {children}
    </AppShell>
  );
}
