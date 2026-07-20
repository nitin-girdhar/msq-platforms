'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@crm/types';
import { canViewTeamTasks } from '@task/authz';

interface Props {
  actor: SessionUser;
}

interface Tab {
  href: string;
  label: string;
  show: boolean;
}

// In-page sub-navigation for the Tasks module — mirrors LeaveTabs.
export default function TasksTabs({ actor }: Props) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { href: '/tasks', label: 'My Tasks', show: true },
    { href: '/tasks/team', label: 'Team', show: canViewTeamTasks(actor.rank) },
  ];

  return (
    <nav className="flex gap-1 border-b border-[#E2E8F0]" aria-label="Tasks sections">
      {tabs
        .filter((t) => t.show)
        .map((tab) => {
          const active =
            tab.href === '/tasks' ? pathname === '/tasks' : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? '-mb-px border-b-2 border-[#0b6cbf] px-4 py-2.5 text-sm font-semibold text-[#0b6cbf]'
                  : '-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-[#64748B] transition-colors hover:text-[#0F172A]'
              }
            >
              {tab.label}
            </Link>
          );
        })}
    </nav>
  );
}
