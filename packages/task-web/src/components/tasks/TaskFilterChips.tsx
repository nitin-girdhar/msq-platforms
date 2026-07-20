'use client';

import { TASK_STATUS_OPTIONS, TASK_PRIORITY_OPTIONS } from '../../lib/tasks/format';
import type { TaskPriorityName, TaskStatusName } from '../../lib/tasks/types';

interface Props {
  status: TaskStatusName | '';
  priority: TaskPriorityName | '';
  includeCompleted: boolean;
  onStatusChange: (v: TaskStatusName | '') => void;
  onPriorityChange: (v: TaskPriorityName | '') => void;
  onIncludeCompletedChange: (v: boolean) => void;
}

export default function TaskFilterChips({
  status,
  priority,
  includeCompleted,
  onStatusChange,
  onPriorityChange,
  onIncludeCompletedChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value as TaskStatusName | '')}
        aria-label="Filter by status"
        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
      >
        <option value="">All statuses</option>
        {TASK_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        value={priority}
        onChange={(e) => onPriorityChange(e.target.value as TaskPriorityName | '')}
        aria-label="Filter by priority"
        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
      >
        <option value="">All priorities</option>
        {TASK_PRIORITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-xs text-[#475569]">
        <input
          type="checkbox"
          checked={includeCompleted}
          onChange={(e) => onIncludeCompletedChange(e.target.checked)}
        />
        Show completed
      </label>
    </div>
  );
}
