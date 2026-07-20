// Tasks-module domain types (web side). These mirror the tasks-service API
// response shapes (services/tasks-service/src/api/v1/tasks,task-lists) and the
// task.vw_tasks_enriched view. Kept in apps/web — @platform/ui-kit stays domain-agnostic.

export type TaskStatusName = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export type TaskPriorityName = 'low' | 'medium' | 'high' | 'urgent';

export type TaskVisibility = 'private' | 'team' | 'org';

export interface TaskView {
  id: string;
  org_id: string;
  list_id: string | null;
  list_name: string | null;
  list_visibility: TaskVisibility | null;
  list_owner_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  created_by: string | null;
  created_by_name: string | null;
  due_at: string | null;
  priority_id: string | null;
  priority_name: TaskPriorityName | null;
  priority_label: string | null;
  status_id: string;
  status_name: TaskStatusName;
  status_label: string;
  status_is_terminal: boolean;
  parent_task_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  tags: string[];
  completed_at: string | null;
  recurrence_rule: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskListView {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  owner_id: string;
  owner_name: string;
  visibility: TaskVisibility;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskCommentView {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string;
  body: string;
  created_at: string;
}

export interface TaskStatusHistoryView {
  id: string;
  task_id: string;
  old_status_id: string | null;
  old_status_name: TaskStatusName | null;
  old_status_label: string | null;
  new_status_id: string;
  new_status_name: TaskStatusName;
  new_status_label: string;
  changed_by_id: string | null;
  changed_by_name: string | null;
  note: string | null;
  changed_at: string;
}

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
