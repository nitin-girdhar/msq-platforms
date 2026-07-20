// ─────────────────────────────────────────────────────────────────────────────
// Tasks service — authorization, visibility resolution, activity logging and
// assignee notifications. No SQL here (all DB access is in tasks.repository);
// no req/res (that is the controller).
//
// Visibility model (see Architecture.md "Tasks"):
//   * own tasks (created_by or assignee) are always visible/editable-by-owner.
//   * a task's list visibility governs who else may see it — private (owner only,
//     even to admins), team (owner + owner's subtree + admins), org (whole org).
//   * standalone tasks (no list) are visible to managers of the creator/assignee
//     (rank ≥ 60) and org admins (rank ≥ 80).
// ─────────────────────────────────────────────────────────────────────────────

import { logActivity } from '@crm/audit-log';
import { canViewTeamTasks, canViewOrgTasks, canAdministerTasks } from '@task/authz';
import { ForbiddenError, NotFoundError } from '../../../lib/errors.js';
import { publishTaskEvent } from '../../../lib/events.js';
import * as repo from './tasks.repository.js';
import type { TaskCtx, TaskRow } from './tasks.repository.js';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
  ListMineTasksInput,
} from '@task/validation';

// ── Visibility / authorization ──────────────────────────────────────────────
async function canViewTask(ctx: TaskCtx, row: TaskRow): Promise<boolean> {
  const me = ctx.user_id;
  if (row.created_by === me || row.assignee_id === me) return true;

  // Others' private list → hidden, even to org admins.
  if (row.list_visibility === 'private') return row.list_owner_id === me;

  if (row.list_visibility === 'org') return true;

  if (row.list_visibility === 'team') {
    if (row.list_owner_id === me) return true;
    if (canAdministerTasks(ctx.rank)) return true;
    if (await repo.isManagerOf(ctx, row.list_owner_id!, me)) return true;
  }

  // Standalone (no list) or team-without-list-authority: managers of the
  // creator/assignee and org admins may see non-private tasks.
  if (canAdministerTasks(ctx.rank)) return true;
  if (
    canViewTeamTasks(ctx.rank) &&
    ((await repo.isManagerOf(ctx, me, row.created_by)) || (await repo.isManagerOf(ctx, me, row.assignee_id)))
  ) {
    return true;
  }
  return false;
}

function canEditTask(ctx: TaskCtx, row: TaskRow): Promise<boolean> | boolean {
  const me = ctx.user_id;
  if (canAdministerTasks(ctx.rank)) return true; // rank ≥ 80
  if (row.created_by === me || row.assignee_id === me) return true;
  // rank ≥ 60 over the assignee.
  if (canViewTeamTasks(ctx.rank)) return repo.isManagerOf(ctx, me, row.assignee_id);
  return false;
}

async function loadVisible(ctx: TaskCtx, id: string): Promise<TaskRow> {
  const row = await repo.getTaskRow(ctx, id);
  if (!row) throw new NotFoundError('Task not found');
  if (!(await canViewTask(ctx, row))) throw new NotFoundError('Task not found');
  return row;
}

// ── Reads ──────────────────────────────────────────────────────────────────
export async function listTasks(ctx: TaskCtx, filters: ListTasksInput) {
  if (filters.scope === 'team' && !canViewTeamTasks(ctx.rank)) {
    throw new ForbiddenError('Insufficient rank for the team task scope');
  }
  if (filters.scope === 'org' && !canViewOrgTasks(ctx.rank)) {
    throw new ForbiddenError('Insufficient rank for the org task scope');
  }
  return repo.listTasks(ctx, filters);
}

export async function listMine(ctx: TaskCtx, filters: ListMineTasksInput) {
  return repo.listMine(ctx, filters);
}

export async function getTask(ctx: TaskCtx, id: string) {
  await loadVisible(ctx, id);
  return repo.getTaskView(ctx, id);
}

// ── Writes ───────────────────────────────────────────────────────────────────
export async function createTask(ctx: TaskCtx, data: CreateTaskInput) {
  const result = await repo.createTask(ctx, data);
  if (result.assignee_id && result.assignee_id !== ctx.user_id) {
    void publishTaskEvent({
      type: 'task:assigned',
      task_id: result.id,
      recipient_id: result.assignee_id,
      org_id: ctx.org_id,
      tenant_id: ctx.tenant_id,
      actor_id: ctx.user_id,
    });
  }
  void logActivity({
    action_type: 'task_created',
    performed_by: ctx.user_id,
    subject_user_id: result.assignee_id ?? null,
    org_id: ctx.org_id,
    new_value: { task_id: result.id, title: data.title },
  });
  return repo.getTaskView(ctx, result.id);
}

export async function updateTask(ctx: TaskCtx, id: string, data: UpdateTaskInput) {
  const row = await loadVisible(ctx, id);
  if (!(await canEditTask(ctx, row))) {
    throw new ForbiddenError('You are not allowed to edit this task');
  }
  const result = await repo.updateTask(ctx, id, data);
  if (result.assignee_changed && result.assignee_id && result.assignee_id !== ctx.user_id) {
    void publishTaskEvent({
      type: 'task:assigned',
      task_id: id,
      recipient_id: result.assignee_id,
      org_id: ctx.org_id,
      tenant_id: ctx.tenant_id,
      actor_id: ctx.user_id,
    });
  }
  void logActivity({
    action_type: 'task_updated',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { task_id: id, status: data.status_name },
  });
  return repo.getTaskView(ctx, id);
}

export async function deleteTask(ctx: TaskCtx, id: string) {
  const row = await repo.getTaskRow(ctx, id);
  if (!row) throw new NotFoundError('Task not found');
  // Creator or org admin (rank ≥ 80).
  if (row.created_by !== ctx.user_id && !canAdministerTasks(ctx.rank)) {
    throw new ForbiddenError('Only the creator or an org admin can delete this task');
  }
  await repo.softDeleteTask(ctx, id);
  void logActivity({
    action_type: 'task_deleted',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { task_id: id },
  });
}

// ── Comments ──────────────────────────────────────────────────────────────────
export async function addComment(ctx: TaskCtx, taskId: string, body: string) {
  await loadVisible(ctx, taskId);
  const result = await repo.addComment(ctx, taskId, body);
  void logActivity({
    action_type: 'task_comment_created',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { task_id: taskId, comment_id: result.id },
  });
  return result;
}

export async function listComments(ctx: TaskCtx, taskId: string) {
  await loadVisible(ctx, taskId);
  return repo.listComments(ctx, taskId);
}

// ── Status history ───────────────────────────────────────────────────────────
export async function getStatusHistory(ctx: TaskCtx, taskId: string) {
  await loadVisible(ctx, taskId);
  return repo.listStatusHistory(ctx, taskId);
}
