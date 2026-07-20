// Pure tasks-module helpers — no React, no I/O. Shared by the tasks composites
// and the server pages. Rank gating itself lives in @task/authz
// (canViewTeamTasks / canViewOrgTasks / canAdministerTasks), already built
// specifically for tasks — imported directly by callers rather than re-derived
// here.

import type { DueBucket, TaskPriorityName, TaskStatusName, TaskVisibility } from './types';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Classifies a task's due_at into a display bucket, relative to local "today". */
export function dueBucket(dueAt: string | null): DueBucket {
  if (!dueAt) return 'none';
  const due = startOfDay(new Date(dueAt));
  const today = startOfDay(new Date());
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 7) return 'week';
  return 'later';
}

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
  none: 'No due date',
};

export const DUE_BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'week', 'later', 'none'];

/** End-of-today as an ISO datetime with offset, for due_before filters. */
export function endOfTodayISO(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function formatDueDate(iso: string | null): string {
  if (!iso) return 'No due date';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Status chip palette — matches the app's badge style (soft bg + strong fg).
export const TASK_STATUS_STYLES: Record<TaskStatusName, { bg: string; fg: string }> = {
  todo: { bg: 'bg-slate-100', fg: 'text-slate-600' },
  in_progress: { bg: 'bg-blue-50', fg: 'text-blue-700' },
  blocked: { bg: 'bg-red-50', fg: 'text-red-700' },
  done: { bg: 'bg-green-50', fg: 'text-green-700' },
  cancelled: { bg: 'bg-slate-100', fg: 'text-slate-500' },
};

export const TASK_PRIORITY_STYLES: Record<TaskPriorityName, { bg: string; fg: string }> = {
  low: { bg: 'bg-slate-100', fg: 'text-slate-600' },
  medium: { bg: 'bg-blue-50', fg: 'text-blue-700' },
  high: { bg: 'bg-amber-50', fg: 'text-amber-700' },
  urgent: { bg: 'bg-red-50', fg: 'text-red-700' },
};

export const TASK_STATUS_OPTIONS: { value: TaskStatusName; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const TASK_PRIORITY_OPTIONS: { value: TaskPriorityName; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export const TASK_VISIBILITY_OPTIONS: { value: TaskVisibility; label: string; help: string }[] = [
  { value: 'private', label: 'Private', help: 'Only you can see this list.' },
  { value: 'team', label: 'Team', help: "You and everyone who reports up to you." },
  { value: 'org', label: 'Organization', help: 'Everyone in your organization.' },
];

/** A task is visibly "overdue" for row/table highlighting: has a due date in
 * the past and hasn't reached a terminal status. */
export function isOverdue(dueAt: string | null, statusIsTerminal: boolean): boolean {
  if (!dueAt || statusIsTerminal) return false;
  return dueBucket(dueAt) === 'overdue';
}
