import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader, UserAdminScopeProvider } from '@platform/ui-kit';
import { TeamShell } from '@platform/team-web';
import { loadTeamData } from '@platform/team-web/server';
import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId, getSelectedTenantName, getSelectedOrgId } from '@/src/lib/tenant-scope';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import ReportingLines from '@/components/users/ReportingLines';

export const dynamic = 'force-dynamic';

type View = 'people' | 'lines';

// Users of the tenant (and optional branch) picked in the navbar — NOT the super
// admin's own session tenant, which is all this screen could show before
// identity-service took `tenant_id`. It is admin-web's Team screen (the shared
// @platform/team-web module: directory, create, edit, branches/roles/weights,
// manager, reset password) mounted inside a UserAdminScopeProvider, so every
// call it makes names the selected tenant. identity-service honours that for
// super_admin only, proves the branch sits inside it, and 404s anyone outside.
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  // The dashboard layout has already gated this route (canOpenLookupAdmin); the
  // session is needed for the cookie header and the actor passed to the shell.
  const result = await getServerSession();
  if (!result) notFound();
  const { session, cookieHeader } = result;

  const tenantId = await getSelectedTenantId();
  if (!tenantId) {
    return (
      <>
        <PageHeader title="Users" />
        <PageBody>
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            Pick a tenant in the top bar to see its users. Pick an org as well to narrow to one branch.
          </p>
        </PageBody>
      </>
    );
  }
  const orgId = await getSelectedOrgId();
  const { view: rawView } = await searchParams;
  const view: View = rawView === 'lines' ? 'lines' : 'people';

  const data = await loadTeamData(cookieHeader, 'tenant', { tenantId, orgId });
  if (!data.ok) return <LookupLoadError title="Users" status={data.status} />;

  // Straight off the session, which is where the tenant scope comes from in the
  // first place — no /lookups/tenants round-trip just to name what we selected.
  const tenantName = (await getSelectedTenantName()) ?? 'Selected tenant';
  const branchName = orgId ? (data.orgs.find((o) => o.id === orgId)?.name ?? 'selected branch') : 'all branches';

  const tab = (v: View, label: string) => (
    <Link
      href={v === 'people' ? '/dashboard/users' : '/dashboard/users?view=lines'}
      aria-current={view === v ? 'page' : undefined}
      className={`inline-flex min-h-[2.75rem] items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-0 ${
        view === v ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
      }`}
    >
      {label}
    </Link>
  );

  return (
    // Keyed by scope so switching tenant/branch drops the previous scope's modal state.
    <UserAdminScopeProvider key={`${tenantId}:${orgId ?? ''}`} tenantId={tenantId} orgId={orgId}>
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <nav aria-label="Users view" className="inline-flex gap-1 rounded-xl border border-outline-variant bg-surface-container-low p-1">
          {tab('people', 'People')}
          {tab('lines', 'Reporting lines')}
        </nav>
      </div>
      {view === 'people' ? (
        <TeamShell
          title="Users"
          tenantName={tenantName}
          scopeLabel={branchName}
          users={data.users}
          actor={session}
          total={data.total}
          orgs={data.orgs}
          myOrgs={data.myOrgs}
          branchesFailed={data.branchesFailed}
          scope={data.scope}
        />
      ) : (
        <ReportingLines tenantId={tenantId} orgId={orgId} branchName={branchName} />
      )}
    </UserAdminScopeProvider>
  );
}
