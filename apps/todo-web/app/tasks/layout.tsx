import TaskModuleShell from '@/components/TaskModuleShell';

export const dynamic = 'force-dynamic';

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return <TaskModuleShell>{children}</TaskModuleShell>;
}
