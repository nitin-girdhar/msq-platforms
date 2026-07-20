'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { tasks as tasksApi, taskLists as taskListsApi } from '../../lib/api/client';
import type { TaskListView, TaskPriorityName, TaskStatusName, TaskView } from '../../lib/tasks/types';
import { TASK_STATUS_OPTIONS, TASK_PRIORITY_OPTIONS, formatDueDate, isOverdue } from '../../lib/tasks/format';
import { useAssignableUsers } from '../../hooks/useAssignableUsers';
import TasksTabs from './TasksTabs';
import TaskStatusChip from './TaskStatusChip';
import TaskPriorityBadge from './TaskPriorityBadge';
import TaskDetailDrawer from './TaskDetailDrawer';

interface Props {
  actor: SessionUser;
}

export default function TeamTasksShell({ actor }: Props) {
  const [items, setItems] = useState<TaskView[]>([]);
  const [lists, setLists] = useState<TaskListView[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatusName | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityName | ''>('');
  const [selectedTask, setSelectedTask] = useState<TaskView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const assignableUsers = useAssignableUsers();

  const loadTasks = useCallback(() => {
    setLoading(true);
    tasksApi
      .list({
        scope: 'team',
        assignee_id: assigneeId || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        include_completed: true,
        limit: 100,
      })
      .then((res) => setItems(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load team tasks.'))
      .finally(() => setLoading(false));
  }, [assigneeId, statusFilter, priorityFilter]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    taskListsApi.list({ scope: 'team', limit: 100 }).then((res) => setLists(res.data)).catch(() => setLists([]));
  }, []);

  return (
    <div className="w-full space-y-6 px-3 py-4 sm:px-4">
      <TasksTabs actor={actor} />

      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Team tasks</h1>
        <p className="mt-1 text-sm text-[#64748B]">Tasks across your team.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          aria-label="Filter by assignee"
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
        >
          <option value="">All assignees</option>
          {assignableUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.name || u.email}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatusName | '')}
          aria-label="Filter by status"
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
        >
          <option value="">All statuses</option>
          {TASK_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as TaskPriorityName | '')}
          aria-label="Filter by priority"
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
        >
          <option value="">All priorities</option>
          {TASK_PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">
          No team tasks found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const overdue = isOverdue(t.due_at, t.status_is_terminal);
                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTask(t)}
                    className={`cursor-pointer border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC] ${overdue ? 'bg-red-50/40' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-[#0F172A]">{t.title}</td>
                    <td className="px-4 py-3 text-[#475569]">{t.assignee_name ?? '—'}</td>
                    <td className="px-4 py-3">{t.priority_name && <TaskPriorityBadge priority={t.priority_name} label={t.priority_label} />}</td>
                    <td className="px-4 py-3"><TaskStatusChip status={t.status_name} label={t.status_label} /></td>
                    <td className={`px-4 py-3 ${overdue ? 'font-semibold text-red-600' : 'text-[#64748B]'}`}>{formatDueDate(t.due_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TaskDetailDrawer
        task={selectedTask}
        lists={lists}
        assignableUsers={assignableUsers}
        onClose={() => setSelectedTask(null)}
        onSaved={() => { loadTasks(); setSelectedTask(null); }}
      />
    </div>
  );
}
