'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@crm/types';
import { canViewTeamTasks } from '@task/authz';
import { tasks as tasksApi } from '../../lib/api/client';
import type { TaskView } from '../../lib/tasks/types';
import { formatDueDate } from '../../lib/tasks/format';
import TaskStatusChip from './TaskStatusChip';
import TaskPriorityBadge from './TaskPriorityBadge';

interface Props {
  leadId: string;
  actor: SessionUser;
}

// Self-fetching, self-hiding section: drop it into the lead-edit modal with a
// lead id. Renders nothing if the tasks module isn't enabled for this tenant
// (the list call 403s with MODULE_NOT_ENABLED) or the lead has no tasks yet
// and the quick-create form hasn't been opened.
export default function TaskLeadSection({ leadId, actor }: Props) {
  const [items, setItems] = useState<TaskView[]>([]);
  const [moduleUnavailable, setModuleUnavailable] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope = canViewTeamTasks(actor.rank) ? 'team' : 'own';

  const load = useCallback(() => {
    tasksApi
      .list({ related_entity_type: 'lead', related_entity_id: leadId, scope, include_completed: true, limit: 50 })
      .then((res) => setItems(res.data))
      .catch(() => setModuleUnavailable(true));
  }, [leadId, scope]);

  useEffect(() => { load(); }, [load]);

  if (moduleUnavailable) return null;

  const createTask = async () => {
    const trimmed = title.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      await tasksApi.create({
        title: trimmed,
        related_entity_type: 'lead',
        related_entity_id: leadId,
        status_name: 'todo',
        priority_name: 'medium',
      });
      setTitle('');
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#94A3B8]">Tasks</p>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="text-xs font-semibold text-[#0b6cbf] hover:underline"
        >
          {showCreate ? 'Cancel' : '+ Add task'}
        </button>
      </div>

      {showCreate && (
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createTask(); }}
            placeholder="New task about this lead…"
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
          />
          <button
            type="button"
            onClick={() => void createTask()}
            disabled={creating || !title.trim()}
            className="shrink-0 rounded-lg bg-[#0b6cbf] px-3 py-2 text-xs font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {items.length === 0 ? (
        <p className="text-xs text-[#94A3B8]">No tasks linked to this lead yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-lg border border-[#F1F5F9] px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-[#0F172A]">{t.title}</span>
              {t.priority_name && <TaskPriorityBadge priority={t.priority_name} label={t.priority_label} />}
              <TaskStatusChip status={t.status_name} label={t.status_label} />
              <span className="w-20 shrink-0 text-right text-xs text-[#94A3B8]">{formatDueDate(t.due_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
