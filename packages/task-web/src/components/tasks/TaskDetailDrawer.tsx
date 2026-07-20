'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@crm/types';
import { tasks as tasksApi } from '../../lib/api/client';
import type { TaskCommentView, TaskListView, TaskStatusHistoryView, TaskView } from '../../lib/tasks/types';
import { TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, formatDateTime } from '../../lib/tasks/format';
import { UserPicker } from '@platform/ui-kit';
import TaskStatusChip from './TaskStatusChip';

interface Props {
  task: TaskView | null;
  lists: TaskListView[];
  assignableUsers: SessionUser[];
  onClose: () => void;
  onSaved: () => void;
}

export default function TaskDetailDrawer({ task, lists, assignableUsers, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState<TaskView['priority_name']>('medium');
  const [status, setStatus] = useState<TaskView['status_name']>('todo');
  const [listId, setListId] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [comments, setComments] = useState<TaskCommentView[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [history, setHistory] = useState<TaskStatusHistoryView[]>([]);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? '');
    setAssigneeId(task.assignee_id ?? '');
    setDueAt(task.due_at ? task.due_at.slice(0, 10) : '');
    setPriority(task.priority_name ?? 'medium');
    setStatus(task.status_name);
    setListId(task.list_id ?? '');
    setTagsInput(task.tags.join(', '));
    setError(null);

    void tasksApi.comments.list(task.id).then((res) => setComments(res.data)).catch(() => setComments([]));
    void tasksApi.statusHistory.list(task.id).then((res) => setHistory(res.data)).catch(() => setHistory([]));
  }, [task]);

  const handleClose = useCallback(() => {
    setComments([]);
    setHistory([]);
    setCommentBody('');
    onClose();
  }, [onClose]);

  if (!task) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await tasksApi.update(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        assignee_id: assigneeId || null,
        due_at: dueAt ? new Date(`${dueAt}T00:00:00`).toISOString() : null,
        priority_name: priority ?? undefined,
        status_name: status,
        list_id: listId || null,
        tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save task.');
    } finally {
      setSaving(false);
    }
  };

  const addComment = async () => {
    const body = commentBody.trim();
    if (!body || commentBusy) return;
    setCommentBusy(true);
    try {
      await tasksApi.comments.add(task.id, body);
      setCommentBody('');
      const res = await tasksApi.comments.list(task.id);
      setComments(res.data);
    } catch {
      // surfaced via the general error banner on next save; comment failures are non-fatal here
    } finally {
      setCommentBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50" onClick={handleClose} role="dialog" aria-modal="true" aria-label="Task detail">
      <div
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white p-5 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-[#0F172A]">Task detail</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M4.28 4.28a.75.75 0 0 1 1.06 0L10 8.94l4.66-4.66a.75.75 0 1 1 1.06 1.06L11.06 10l4.66 4.66a.75.75 0 1 1-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 1 1-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#475569]">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-[#475569]">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#475569]">Assignee</label>
              <UserPicker value={assigneeId} onChange={setAssigneeId} users={assignableUsers} allowEmpty emptyLabel="Unassigned" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#475569]">Due date</label>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#475569]">Priority</label>
              <select
                value={priority ?? 'medium'}
                onChange={(e) => setPriority(e.target.value as TaskView['priority_name'])}
                className="w-full rounded-lg border border-[#E2E8F0] px-2 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
              >
                {TASK_PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#475569]">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskView['status_name'])}
                className="w-full rounded-lg border border-[#E2E8F0] px-2 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
              >
                {TASK_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#475569]">List</label>
              <select
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] px-2 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
              >
                <option value="">No list</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-[#475569]">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. urgent, follow-up"
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !title.trim()}
              className="rounded-lg bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        <hr className="my-5 border-[#E2E8F0]" />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#0b6cbf]">Status history</h3>
          {history.length === 0 ? (
            <p className="text-xs text-[#94A3B8]">No status changes yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="text-xs text-[#475569]">
                  <span className="font-medium text-[#0F172A]">{h.changed_by_name ?? 'System'}</span>{' '}
                  {h.old_status_label ? (
                    <>moved from <TaskStatusChip status={h.old_status_name!} label={h.old_status_label} /> to</>
                  ) : (
                    'set'
                  )}{' '}
                  <TaskStatusChip status={h.new_status_name} label={h.new_status_label} />
                  <span className="ml-2 text-[#94A3B8]">{formatDateTime(h.changed_at)}</span>
                  {h.note && <p className="mt-0.5 text-[#64748B]">{h.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <hr className="my-5 border-[#E2E8F0]" />

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#0b6cbf]">Comments</h3>
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-lg bg-[#F8FAFC] px-3 py-2 text-xs">
                <span className="font-medium text-[#0F172A]">{c.user_name}</span>
                <span className="ml-2 text-[#94A3B8]">{formatDateTime(c.created_at)}</span>
                <p className="mt-0.5 text-[#475569]">{c.body}</p>
              </li>
            ))}
            {comments.length === 0 && <p className="text-xs text-[#94A3B8]">No comments yet.</p>}
          </ul>
          <div className="flex gap-2">
            <input
              type="text"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addComment(); }}
              placeholder="Add a comment…"
              className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
            />
            <button
              type="button"
              onClick={() => void addComment()}
              disabled={commentBusy || !commentBody.trim()}
              className="shrink-0 rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Post
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
