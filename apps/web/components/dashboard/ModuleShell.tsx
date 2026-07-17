import { redirect } from 'next/navigation';
import DashboardNavbar from '@/components/dashboard/DashboardNavbar';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import SidebarController from '@/components/dashboard/SidebarController';
import { NotificationProvider } from '@/providers/NotificationProvider';
import { requireSession } from '@/src/lib/require-session';
import { getEnabledModules, type PlatformModule } from '@/src/lib/modules';

interface Props {
  module: PlatformModule;
  children: React.ReactNode;
}

// Shared authenticated chrome for the newer platform modules (/leave,
// /attendance, /tasks) — same navbar/sidebar/session gating as the CRM
// dashboard layout (app/dashboard/layout.tsx), plus a check that the tenant
// actually has this module enabled. An unknown/disabled module redirects to
// the CRM default landing page, matching how other under-privileged routes
// in this app (e.g. app/dashboard/team/page.tsx) redirect rather than 404.
export default async function ModuleShell({ module, children }: Props) {
  const { session, cookieHeader } = await requireSession(`/${module}`);
  const enabledModules = await getEnabledModules(cookieHeader);

  if (!enabledModules.includes(module)) {
    redirect('/dashboard/leads');
  }

  return (
    <NotificationProvider>
      <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-full lg:min-h-0 lg:overflow-hidden">
        <DashboardNavbar user={session} enabledModules={enabledModules} />
        <SidebarController role={session.role} />
        <div className="flex w-full flex-1 lg:min-h-0 lg:overflow-hidden">
          <DashboardSidebar role={session.role} />
          <main className="flex w-full min-w-0 flex-1 flex-col lg:overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </NotificationProvider>
  );
}
