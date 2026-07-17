import { logActivity } from '@crm/audit-log';
import { canViewTeamTasks, canViewOrgTasks, canAdministerTasks } from '@crm/permissions';
import { ForbiddenError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './task-lists.repository.js';
import type { TaskCtx } from './task-lists.repository.js';
import type { CreateTaskListInput, UpdateTaskListInput, ListTaskListsInput } from '@crm/validation';

export async function listTaskLists(ctx: TaskCtx, filters: ListTaskListsInput) {
  if (filters.scope === 'team' && !canViewTeamTasks(ctx.rank)) {
    throw new ForbiddenError('Insufficient rank for the team task-list scope');
  }
  if (filters.scope === 'org' && !canViewOrgTasks(ctx.rank)) {
    throw new ForbiddenError('Insufficient rank for the org task-list scope');
  }
  return repo.listTaskLists(ctx, filters);
}

// Shared visibility gate for a single list. Private lists are visible ONLY to the
// owner (even to org admins); team lists to the owner + their subtree (+ admin);
// org lists to anyone in the org.
async function assertCanView(ctx: TaskCtx, row: repo.TaskListRow): Promise<void> {
  if (row.owner_id === ctx.user_id) return;
  if (row.visibility === 'org') return;
  if (row.visibility === 'team' && (canAdministerTasks(ctx.rank) || (await repo.isManagerOf(ctx, row.owner_id, ctx.user_id)))) {
    return;
  }
  // private (or team without authority) → hidden.
  throw new NotFoundError('Task list not found');
}

export async function getTaskList(ctx: TaskCtx, id: string) {
  const row = await repo.getTaskListRow(ctx, id);
  if (!row) throw new NotFoundError('Task list not found');
  await assertCanView(ctx, row);
  return repo.getTaskListView(ctx, id);
}

export async function createTaskList(ctx: TaskCtx, data: CreateTaskListInput) {
  const result = await repo.createTaskList(ctx, data);
  void logActivity({
    action_type: 'task_list_created',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { list_id: result.id, name: data.name, visibility: data.visibility },
  });
  return result;
}

async function loadForWrite(ctx: TaskCtx, id: string): Promise<repo.TaskListRow> {
  const row = await repo.getTaskListRow(ctx, id);
  if (!row) throw new NotFoundError('Task list not found');
  // Owner or org admin may mutate/delete.
  if (row.owner_id !== ctx.user_id && !canAdministerTasks(ctx.rank)) {
    throw new ForbiddenError('Only the list owner or an org admin can modify this list');
  }
  return row;
}

export async function updateTaskList(ctx: TaskCtx, id: string, data: UpdateTaskListInput) {
  await loadForWrite(ctx, id);
  await repo.updateTaskList(ctx, id, data);
  void logActivity({
    action_type: 'task_list_updated',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { list_id: id },
  });
}

export async function deleteTaskList(ctx: TaskCtx, id: string) {
  await loadForWrite(ctx, id);
  await repo.softDeleteTaskList(ctx, id);
  void logActivity({
    action_type: 'task_list_deleted',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { list_id: id },
  });
}
