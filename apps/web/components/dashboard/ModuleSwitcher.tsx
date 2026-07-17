'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PlatformModule } from '@/src/lib/modules';

const MODULE_LABELS: Record<PlatformModule, string> = {
  crm: 'CRM',
  leave: 'Leave',
  attendance: 'Attendance',
  tasks: 'Tasks',
};

const MODULE_HREF: Record<PlatformModule, string> = {
  crm: '/dashboard/leads',
  leave: '/leave',
  attendance: '/attendance',
  tasks: '/tasks',
};

interface Props {
  enabledModules: PlatformModule[];
}

export default function ModuleSwitcher({ enabledModules }: Props) {
  const pathname = usePathname();

  // Nothing to switch between when the tenant only has CRM.
  if (enabledModules.length <= 1) return null;

  const active: PlatformModule = pathname.startsWith('/leave')
    ? 'leave'
    : pathname.startsWith('/attendance')
      ? 'attendance'
      : pathname.startsWith('/tasks')
        ? 'tasks'
        : 'crm';

  return (
    <nav
      aria-label="Modules"
      className="hidden items-center gap-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-1 sm:flex"
    >
      {enabledModules.map((m) => (
        <Link
          key={m}
          href={MODULE_HREF[m]}
          aria-current={active === m ? 'page' : undefined}
          className={
            active === m
              ? 'rounded-md bg-white px-3 py-1 text-xs font-semibold text-[#0b6cbf] shadow-sm'
              : 'rounded-md px-3 py-1 text-xs font-medium text-[#475569] transition-colors hover:text-[#0F172A]'
          }
        >
          {MODULE_LABELS[m]}
        </Link>
      ))}
    </nav>
  );
}
