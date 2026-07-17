import DashboardNavbar from '@/components/dashboard/DashboardNavbar';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import SidebarController from '@/components/dashboard/SidebarController';
import { NotificationProvider } from '@/providers/NotificationProvider';
import { requireSession } from '@/src/lib/require-session';
import { getEnabledModules } from '@/src/lib/modules';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, cookieHeader } = await requireSession('/dashboard');
  const enabledModules = await getEnabledModules(cookieHeader);

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
