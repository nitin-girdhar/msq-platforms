import ModuleShell from '@/components/dashboard/ModuleShell';

export const dynamic = 'force-dynamic';

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  return <ModuleShell module="leave">{children}</ModuleShell>;
}
