import { redirect } from 'next/navigation';
import { NotificationProvider, productOrigins } from '@platform/ui-kit';
import { AppNavbar, AppSidebar, MobileSidebar } from '@platform/ui-kit/shell';
import { requireSession, getEnabledModules } from '@platform/ui-kit/server';
import { TASK_NAV } from '@/src/config/navigation';

interface Props {
  children: React.ReactNode;
}

// Authenticated Task chrome (todo.app.com). Same session gating + shared
// navbar/sidebar as the other product apps, plus a check that the tenant has
// the `tasks` module enabled and is licensed for the `task` product.
export default async function TaskModuleShell({ children }: Props) {
  const { session, cookieHeader, licensedProducts } = await requireSession('/tasks');
  const enabledModules = await getEnabledModules(cookieHeader);

  if (!enabledModules.includes('tasks') || !licensedProducts.includes('task')) {
    const origins = productOrigins();
    redirect(origins.lms ? `${origins.lms}/dashboard/leads` : '/tasks');
  }

  const origins = productOrigins();

  return (
    <NotificationProvider>
      <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-full lg:min-h-0 lg:overflow-hidden">
        <AppNavbar
          user={session}
          licensedProducts={licensedProducts}
          productOrigins={origins}
          activeProduct="task"
          homeHref="/tasks"
          title="Fitclass - Tasks"
        />
        <MobileSidebar role={session.role} items={TASK_NAV} />
        <div className="flex w-full flex-1 lg:min-h-0 lg:overflow-hidden">
          <AppSidebar role={session.role} items={TASK_NAV} />
          <main className="flex w-full min-w-0 flex-1 flex-col lg:overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </NotificationProvider>
  );
}
