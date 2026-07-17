import ModuleShell from '@/components/dashboard/ModuleShell';

export const dynamic = 'force-dynamic';

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return <ModuleShell module="tasks">{children}</ModuleShell>;
}
