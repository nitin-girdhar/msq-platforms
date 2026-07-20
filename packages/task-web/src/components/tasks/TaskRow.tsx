'use client';

import type { TaskView } from '../../lib/tasks/types';
import { TASK_STATUS_OPTIONS, formatDueDate, isOverdue } from '../../lib/tasks/format';
import TaskPriorityBadge from './TaskPriorityBadge';

interface Props {
  task: TaskView;
  onOpen: (task: TaskView) => void;
  onStatusChange: (task: TaskView, status: string) => void;
}

export default function TaskRow({ task, onOpen, onStatusChange }: Props) {
  const overdue = isOverdue(task.due_at, task.status_is_terminal);

  return (
    <div
      className={`flex flex-wrap items-center gap-3 border-b border-[#F1F5F9] px-4 py-3 last:border-0 hover:bg-[#F8FAFC] ${
        overdue ? 'bg-red-50/40' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="min-w-0 flex-1 text-left"
      >
        <span className={`block truncate text-sm font-medium ${task.status_is_terminal ? 'text-[#94A3B8] line-through' : 'text-[#0F172A]'}`}>
          {task.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[#94A3B8]">
          {task.list_name ?? 'No list'}
          {task.assignee_name ? ` · ${task.assignee_name}` : ''}
        </span>
      </button>

      {task.priority_name && <TaskPriorityBadge priority={task.priority_name} label={task.priority_label} />}

      <span className={`w-24 shrink-0 text-right text-xs ${overdue ? 'font-semibold text-red-600' : 'text-[#64748B]'}`}>
        {formatDueDate(task.due_at)}
      </span>

      <select
        value={task.status_name}
        onChange={(e) => onStatusChange(task, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Status for ${task.title}`}
        className="shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
      >
        {TASK_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
