'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SessionUser } from '@crm/types';
import { tasks as tasksApi } from '@/src/lib/api/tasks';
import { leave as leaveApi } from '@/src/lib/api/hr';
import { endOfTodayISO } from '@/src/lib/tasks/format';
import { canViewLeaveApprovals } from '@/src/lib/leave/format';
import type { PlatformModule } from '@/src/lib/modules';

interface Props {
  actor: SessionUser;
  enabledModules: PlatformModule[];
}

interface Tile {
  key: string;
  label: string;
  count: number;
  href: string;
}

export default function MyDayWidget({ actor, enabledModules }: Props) {
  const tasksEnabled = enabledModules.includes('tasks');
  const leaveEnabled = enabledModules.includes('leave');
  const isApprover = leaveEnabled && canViewLeaveApprovals(actor.rank);

  const [tiles, setTiles] = useState<Tile[]>([]);

  useEffect(() => {
    if (!tasksEnabled && !leaveEnabled) return;
    let cancelled = false;

    (async () => {
      const results: Tile[] = [];

      if (tasksEnabled) {
        try {
          const res = await tasksApi.list({
            scope: 'own',
            assignee_id: actor.id,
            include_completed: false,
            due_before: endOfTodayISO(),
            limit: 1,
          });
          results.push({ key: 'tasks', label: 'Tasks due today', count: res.total, href: '/tasks' });
        } catch {
          // module not enabled or transient failure — omit the tile
        }
      }

      if (isApprover) {
        try {
          const pending = await leaveApi.teamRequests({ status: 'pending', page: 1, limit: 1 });
          results.push({ key: 'approvals', label: 'Pending approvals', count: pending.total, href: '/leave/approvals' });

          const today = new Date().toISOString().slice(0, 10);
          const onLeave = await leaveApi.teamRequests({ status: 'approved', from: today, to: today, page: 1, limit: 1 });
          results.push({ key: 'on-leave', label: 'On leave today', count: onLeave.total, href: '/leave/approvals' });
        } catch {
          // ignore
        }
      }

      if (!cancelled) setTiles(results);
    })();

    return () => { cancelled = true; };
  }, [tasksEnabled, leaveEnabled, isApprover, actor.id]);

  if (tiles.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-[#E2E8F0] bg-white px-4 py-3 sm:px-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            href={tile.href}
            className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 shadow-sm transition-colors hover:border-[#0b6cbf]"
          >
            <p className="text-2xl font-bold text-[#0F172A]">{tile.count}</p>
            <p className="mt-0.5 text-xs text-[#64748B]">{tile.label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
