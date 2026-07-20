// Tasks-module API namespace. Built on the same generic fetch wrapper
// (@platform/ui-kit `createApiClient`) as the CRM `client.ts` and the HR `hr.ts`.
// Paths are the gateway prefixes — Next.js rewrites `/api/:path*` → gateway
// `/:path*` (apps/web/next.config.ts), so `/tasks/*` and `/task-lists/*`
// reach tasks-service via the gateway.

import { createApiClient } from '@platform/ui-kit';
import type {
  TaskView,
  TaskListView,
  TaskCommentView,
  TaskStatusHistoryView,
  TaskStatusName,
  TaskPriorityName,
  TaskVisibility,
} from '../tasks/types';

const { request } = createApiClient('/api');

function qs(params: object): string {
  const s = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return s ? `?${s}` : '';
}

interface Envelope<T> {
  success: true;
  data: T;
}
interface ListEnvelope<T> {
  success: true;
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export interface ListTasksParams {
  page?: number | undefined;
  limit?: number | undefined;
  scope?: 'own' | 'team' | 'org' | undefined;
  assignee_id?: string | undefined;
  status?: TaskStatusName | undefined;
  priority?: TaskPriorityName | undefined;
  list_id?: string | undefined;
  due_before?: string | undefined;
  due_after?: string | undefined;
  related_entity_type?: string | undefined;
  related_entity_id?: string | undefined;
  q?: string | undefined;
  include_completed?: boolean | undefined;
}

export interface CreateTaskBody {
  title: string;
  description?: string | null | undefined;
  list_id?: string | null | undefined;
  assignee_id?: string | null | undefined;
  due_at?: string | null | undefined;
  priority_name?: TaskPriorityName | undefined;
  status_name?: TaskStatusName | undefined;
  parent_task_id?: string | null | undefined;
  related_entity_type?: string | null | undefined;
  related_entity_id?: string | null | undefined;
  tags?: string[] | undefined;
}

export interface UpdateTaskBody {
  title?: string | undefined;
  description?: string | null | undefined;
  list_id?: string | null | undefined;
  assignee_id?: string | null | undefined;
  due_at?: string | null | undefined;
  priority_name?: TaskPriorityName | undefined;
  status_name?: TaskStatusName | undefined;
  tags?: string[] | undefined;
  note?: string | null | undefined;
}

export const tasks = {
  list: (params: ListTasksParams = {}) => request<ListEnvelope<TaskView>>(`/tasks${qs(params)}`),

  mine: (params: { page?: number; limit?: number } = {}) =>
    request<ListEnvelope<TaskView>>(`/tasks/mine${qs(params)}`),

  get: (id: string) => request<Envelope<TaskView>>(`/tasks/${id}`),

  create: (body: CreateTaskBody) =>
    request<Envelope<TaskView>>('/tasks', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: UpdateTaskBody) =>
    request<Envelope<TaskView>>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  comments: {
    list: (taskId: string) => request<Envelope<TaskCommentView[]>>(`/tasks/${taskId}/comments`),

    add: (taskId: string, body: string) =>
      request<Envelope<{ id: string }>>(`/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
  },

  statusHistory: {
    list: (taskId: string) =>
      request<Envelope<TaskStatusHistoryView[]>>(`/tasks/${taskId}/status-history`),
  },
};

// ── Task lists ───────────────────────────────────────────────────────────────

export interface ListTaskListsParams {
  page?: number | undefined;
  limit?: number | undefined;
  scope?: 'own' | 'team' | 'org' | undefined;
}

export interface CreateTaskListBody {
  name: string;
  description?: string | null | undefined;
  visibility?: TaskVisibility | undefined;
}

export interface UpdateTaskListBody {
  name?: string | undefined;
  description?: string | null | undefined;
  visibility?: TaskVisibility | undefined;
  is_active?: boolean | undefined;
}

export const taskLists = {
  list: (params: ListTaskListsParams = {}) =>
    request<ListEnvelope<TaskListView>>(`/task-lists${qs(params)}`),

  get: (id: string) => request<Envelope<TaskListView>>(`/task-lists/${id}`),

  create: (body: CreateTaskListBody) =>
    request<Envelope<{ id: string }>>('/task-lists', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: UpdateTaskListBody) =>
    request<void>(`/task-lists/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string) => request<void>(`/task-lists/${id}`, { method: 'DELETE' }),
};
