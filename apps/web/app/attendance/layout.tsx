import ModuleShell from '@/components/dashboard/ModuleShell';

export const dynamic = 'force-dynamic';

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  return <ModuleShell module="attendance">{children}</ModuleShell>;
}
