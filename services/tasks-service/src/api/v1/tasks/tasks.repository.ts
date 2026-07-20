// ─────────────────────────────────────────────────────────────────────────────
// Tasks repository — all DB access for task.tasks / task.task_comments.
//
// Conventions (mirroring services/hr-service leave.repository):
//   - Own-scope reads (GET /tasks?scope=own, /tasks/mine) run in withRoleTx so
//     task.* RLS scopes them (org isolation). The private/team narrowing there is
//     trivially satisfied because the rows are the caller's own (created/assignee).
//   - team/org-scope reads run in withServiceTx (BYPASSRLS) after an app-layer
//     rank check, ALWAYS explicitly scoped by the gateway-verified org_id, and the
//     private/team visibility rule is applied here in SQL (see Architecture.md
//     "Tasks" — a task's effective visibility derives from its list's visibility;
//     others' private-list tasks stay hidden even from org admins).
//   - Writes run in withRoleTx (app_user). Status transitions are logged by the
//     task.log_task_status_change trigger (SECURITY DEFINER), which reads the
//     app.current_user_id GUC (set by withRoleTx) and the app.task_transition_note
//     GUC (set here before the update). completed_at is auto-managed by the
//     task.set_task_completion trigger.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, type RoleTxContext, type DrizzleTx } from '@crm/db';
import { BadRequestError, NotFoundError } from '../../../lib/errors.js';
import type { CreateTaskInput, UpdateTaskInput, ListTasksInput, ListMineTasksInput } from '@task/validation';

export type TaskCtx = RoleTxContext & { rank: number };
type Row = Record<string, unknown>;

// ── Small lookups (global, no RLS) ──────────────────────────────────────────
async function resolveStatusId(tx: DrizzleTx, name: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT id::text FROM task.task_statuses WHERE name = ${name} AND is_active
  `)) as unknown as Array<{ id: string }>;
  if (!rows[0]) throw new BadRequestError(`Unknown or inactive task status: ${name}`);
  return rows[0].id;
}

async function resolvePriorityId(tx: DrizzleTx, name: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT id::text FROM task.task_priorities WHERE name = ${name} AND is_active
  `)) as unknown as Array<{ id: string }>;
  if (!rows[0]) throw new BadRequestError(`Unknown or inactive task priority: ${name}`);
  return rows[0].id;
}

// Validate the assignee is an active member of the acting org. Runs in a service
// transaction (BYPASSRLS): the acting user may be a rank-20 rep who cannot read
// a peer's iam.user_org_mapping row under RLS, but must still be able to assign a
// task to them. Read-only, always explicitly scoped by the gateway-verified org.
async function assertAssigneeActive(ctx: TaskCtx, userId: string): Promise<void> {
  const ok = await withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1 FROM iam.user_org_mapping WHERE user_id = ${userId} AND org_id = ${ctx.org_id} AND is_active LIMIT 1
    `)) as unknown as Row[];
    return rows.length > 0;
  });
  if (!ok) throw new BadRequestError('Assignee is not an active member of this org');
}

async function assertListUsable(tx: DrizzleTx, orgId: string, listId: string): Promise<void> {
  // Under RLS (app_user) another user's private list is invisible, so a missing
  // row here means "not found or not permitted".
  const rows = (await tx.execute(sql`
    SELECT 1 FROM task.task_lists WHERE id = ${listId} AND org_id = ${orgId} AND NOT is_deleted LIMIT 1
  `)) as unknown as Row[];
  if (rows.length === 0) throw new BadRequestError('Task list not found or not accessible');
}

async function assertParentTask(tx: DrizzleTx, orgId: string, parentId: string): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM task.tasks WHERE id = ${parentId} AND org_id = ${orgId} AND NOT is_deleted LIMIT 1
  `)) as unknown as Row[];
  if (rows.length === 0) throw new BadRequestError('Parent task not found');
}

function tagsSql(tags: string[] | undefined): ReturnType<typeof sql> {
  const list = tags ?? [];
  if (list.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(list.map((t) => sql`${t}`), sql`, `)}]::text[]`;
}

// ── Filter + scope SQL builders ─────────────────────────────────────────────
function filterClause(f: ListTasksInput): ReturnType<typeof sql> {
  const clauses: ReturnType<typeof sql>[] = [];
  if (f.assignee_id) clauses.push(sql`AND e.assignee_id = ${f.assignee_id}`);
  if (f.status) clauses.push(sql`AND e.status_name = ${f.status}`);
  if (f.priority) clauses.push(sql`AND e.priority_name = ${f.priority}`);
  if (f.list_id) clauses.push(sql`AND e.list_id = ${f.list_id}`);
  if (f.due_before) clauses.push(sql`AND e.due_at <= ${f.due_before}`);
  if (f.due_after) clauses.push(sql`AND e.due_at >= ${f.due_after}`);
  if (f.related_entity_type) clauses.push(sql`AND e.related_entity_type = ${f.related_entity_type}`);
  if (f.related_entity_id) clauses.push(sql`AND e.related_entity_id = ${f.related_entity_id}`);
  if (f.q) clauses.push(sql`AND e.title ILIKE ${'%' + f.q + '%'}`);
  if (!f.include_completed) clauses.push(sql`AND NOT e.status_is_terminal`);
  return clauses.length ? sql.join(clauses, sql` `) : sql``;
}

// Visibility + scope predicate for the team/org read paths (service tx).
function scopeVisibilityClause(ctx: TaskCtx, scope: 'team' | 'org'): ReturnType<typeof sql> {
  const me = ctx.user_id;
  const org = ctx.org_id;
  // A list a caller may see: null (standalone), non-private, or their own.
  const listVisible = sql`(e.list_id IS NULL OR e.list_visibility <> 'private' OR e.list_owner_id = ${me})`;
  if (scope === 'org') {
    return sql`AND (e.created_by = ${me} OR e.assignee_id = ${me} OR ${listVisible})`;
  }
  // team: my subtree's tasks (or team/org lists I can see), minus others' private.
  return sql`AND (
    e.created_by = ${me} OR e.assignee_id = ${me}
    OR (
      ${listVisible}
      AND (
        EXISTS (SELECT 1 FROM iam.vw_user_team_members m
                WHERE m.manager_id = ${me} AND m.org_id = ${org}
                  AND (m.member_id = e.created_by OR m.member_id = e.assignee_id))
        OR e.list_visibility = 'org'
        OR (e.list_visibility = 'team' AND (
          e.list_owner_id = ${me}
          OR EXISTS (SELECT 1 FROM iam.vw_user_team_members m2
                     WHERE m2.manager_id = e.list_owner_id AND m2.member_id = ${me} AND m2.org_id = ${org})
        ))
      )
    )
  )`;
}

// ── LIST ─────────────────────────────────────────────────────────────────────
export async function listTasks(ctx: TaskCtx, filters: ListTasksInput) {
  const { page, limit, scope } = filters;
  const offset = (page - 1) * limit;
  const filters_ = filterClause(filters);

  if (scope === 'own') {
    return withRoleTx(ctx, async (tx) => {
      const where = sql`
        WHERE e.org_id = ${ctx.org_id}
          AND (e.created_by = ${ctx.user_id} OR e.assignee_id = ${ctx.user_id})
          ${filters_}
      `;
      const rows = (await tx.execute(sql`
        SELECT * FROM task.vw_tasks_enriched e ${where}
        ORDER BY e.created_at DESC LIMIT ${limit} OFFSET ${offset}
      `)) as unknown as Row[];
      const countRows = (await tx.execute(sql`
        SELECT COUNT(*)::int AS count FROM task.vw_tasks_enriched e ${where}
      `)) as unknown as Array<{ count: number }>;
      return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
    });
  }

  return withServiceTx(async (tx) => {
    const where = sql`
      WHERE e.org_id = ${ctx.org_id}
        ${scopeVisibilityClause(ctx, scope)}
        ${filters_}
    `;
    const rows = (await tx.execute(sql`
      SELECT * FROM task.vw_tasks_enriched e ${where}
      ORDER BY e.created_at DESC LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Row[];
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count FROM task.vw_tasks_enriched e ${where}
    `)) as unknown as Array<{ count: number }>;
    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

export async function listMine(ctx: TaskCtx, filters: ListMineTasksInput) {
  const { page, limit } = filters;
  const offset = (page - 1) * limit;
  return withRoleTx(ctx, async (tx) => {
    const where = sql`
      WHERE e.org_id = ${ctx.org_id} AND e.assignee_id = ${ctx.user_id} AND NOT e.status_is_terminal
    `;
    const rows = (await tx.execute(sql`
      SELECT * FROM task.vw_tasks_enriched e ${where}
      ORDER BY e.due_at ASC NULLS LAST, e.priority_sort_order DESC NULLS LAST, e.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Row[];
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count FROM task.vw_tasks_enriched e ${where}
    `)) as unknown as Array<{ count: number }>;
    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

// Raw row (service scope) used by the detail/visibility/authorization paths.
export interface TaskRow {
  id: string;
  org_id: string;
  list_id: string | null;
  list_visibility: 'private' | 'team' | 'org' | null;
  list_owner_id: string | null;
  created_by: string | null;
  assignee_id: string | null;
  status_name: string;
}

export async function getTaskRow(ctx: TaskCtx, id: string): Promise<TaskRow | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT e.id::text, e.org_id::text, e.list_id::text, e.list_visibility,
             e.list_owner_id::text, e.created_by::text, e.assignee_id::text, e.status_name
      FROM task.vw_tasks_enriched e
      WHERE e.id = ${id} AND e.org_id = ${ctx.org_id}
    `)) as unknown as TaskRow[];
    return rows[0] ?? null;
  });
}

export async function getTaskView(ctx: TaskCtx, id: string): Promise<Row | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT * FROM task.vw_tasks_enriched e WHERE e.id = ${id} AND e.org_id = ${ctx.org_id}
    `)) as unknown as Row[];
    return rows[0] ?? null;
  });
}

export async function isManagerOf(ctx: TaskCtx, managerId: string, memberId: string | null): Promise<boolean> {
  if (!memberId || managerId === memberId) return false;
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1 FROM iam.vw_user_team_members
      WHERE manager_id = ${managerId} AND member_id = ${memberId} AND org_id = ${ctx.org_id}
      LIMIT 1
    `)) as unknown as Row[];
    return rows.length > 0;
  });
}

// ── CREATE ─────────────────────────────────────────────────────────────────
export interface CreateResult {
  id: string;
  assignee_id: string | null;
}

export async function createTask(ctx: TaskCtx, data: CreateTaskInput): Promise<CreateResult> {
  if (data.assignee_id) await assertAssigneeActive(ctx, data.assignee_id);
  return withRoleTx(ctx, async (tx) => {
    const statusId = await resolveStatusId(tx, data.status_name);
    const priorityId = await resolvePriorityId(tx, data.priority_name);

    if (data.list_id) await assertListUsable(tx, ctx.org_id, data.list_id);
    if (data.parent_task_id) await assertParentTask(tx, ctx.org_id, data.parent_task_id);

    const rows = (await tx.execute(sql`
      INSERT INTO task.tasks
        (org_id, list_id, title, description, assignee_id, due_at, priority_id, status_id,
         parent_task_id, related_entity_type, related_entity_id, tags, recurrence_rule, created_by)
      VALUES
        (${ctx.org_id}, ${data.list_id ?? null}, ${data.title}, ${data.description ?? null},
         ${data.assignee_id ?? null}, ${data.due_at ?? null}, ${priorityId}, ${statusId},
         ${data.parent_task_id ?? null}, ${data.related_entity_type ?? null}, ${data.related_entity_id ?? null},
         ${tagsSql(data.tags)}, ${data.recurrence_rule ?? null}, ${ctx.user_id})
      RETURNING id::text, assignee_id::text
    `)) as unknown as Array<{ id: string; assignee_id: string | null }>;
    return { id: rows[0]!.id, assignee_id: rows[0]!.assignee_id };
  });
}

// ── UPDATE ─────────────────────────────────────────────────────────────────
export interface UpdateResult {
  id: string;
  assignee_id: string | null;
  assignee_changed: boolean;
}

export async function updateTask(ctx: TaskCtx, id: string, data: UpdateTaskInput): Promise<UpdateResult> {
  if (data.assignee_id) await assertAssigneeActive(ctx, data.assignee_id);
  return withRoleTx(ctx, async (tx) => {
    // Load current row (RLS-scoped to org).
    const currentRows = (await tx.execute(sql`
      SELECT id::text, assignee_id::text FROM task.tasks
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as Array<{ id: string; assignee_id: string | null }>;
    const current = currentRows[0];
    if (!current) throw new NotFoundError('Task not found');

    const sets: ReturnType<typeof sql>[] = [];
    if (data.title !== undefined) sets.push(sql`title = ${data.title}`);
    if (data.description !== undefined) sets.push(sql`description = ${data.description}`);
    if (data.list_id !== undefined) {
      if (data.list_id) await assertListUsable(tx, ctx.org_id, data.list_id);
      sets.push(sql`list_id = ${data.list_id}`);
    }
    let assigneeChanged = false;
    let newAssignee: string | null = current.assignee_id;
    if (data.assignee_id !== undefined) {
      sets.push(sql`assignee_id = ${data.assignee_id}`);
      assigneeChanged = data.assignee_id !== current.assignee_id;
      newAssignee = data.assignee_id;
    }
    if (data.due_at !== undefined) sets.push(sql`due_at = ${data.due_at}`);
    if (data.priority_name !== undefined) sets.push(sql`priority_id = ${await resolvePriorityId(tx, data.priority_name)}`);
    if (data.parent_task_id !== undefined) {
      if (data.parent_task_id) {
        if (data.parent_task_id === id) throw new BadRequestError('A task cannot be its own parent');
        await assertParentTask(tx, ctx.org_id, data.parent_task_id);
      }
      sets.push(sql`parent_task_id = ${data.parent_task_id}`);
    }
    if (data.related_entity_type !== undefined) sets.push(sql`related_entity_type = ${data.related_entity_type}`);
    if (data.related_entity_id !== undefined) sets.push(sql`related_entity_id = ${data.related_entity_id}`);
    if (data.tags !== undefined) sets.push(sql`tags = ${tagsSql(data.tags)}`);
    if (data.recurrence_rule !== undefined) sets.push(sql`recurrence_rule = ${data.recurrence_rule}`);
    if (data.status_name !== undefined) sets.push(sql`status_id = ${await resolveStatusId(tx, data.status_name)}`);

    if (sets.length === 0) {
      return { id, assignee_id: newAssignee, assignee_changed: false };
    }

    // Transition note for the status-log trigger (only meaningful on a status change).
    if (data.status_name !== undefined && data.note != null) {
      await tx.execute(sql`SELECT set_config('app.task_transition_note', ${data.note}, true)`);
    }

    await tx.execute(sql`
      UPDATE task.tasks SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `);
    return { id, assignee_id: newAssignee, assignee_changed: assigneeChanged };
  });
}

// ── DELETE (soft) ────────────────────────────────────────────────────────────
export async function softDeleteTask(ctx: TaskCtx, id: string): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    const res = (await tx.execute(sql`
      UPDATE task.tasks
      SET is_deleted = TRUE, is_active = FALSE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${ctx.user_id}
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
      RETURNING id::text
    `)) as unknown as Row[];
    if (res.length === 0) throw new NotFoundError('Task not found');
  });
}

// ── COMMENTS ─────────────────────────────────────────────────────────────────
export async function addComment(ctx: TaskCtx, taskId: string, body: string): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      INSERT INTO task.task_comments (org_id, task_id, user_id, body)
      VALUES (${ctx.org_id}, ${taskId}, ${ctx.user_id}, ${body})
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    return { id: rows[0]!.id };
  });
}

export async function listComments(ctx: TaskCtx, taskId: string) {
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(sql`
      SELECT c.id::text, c.task_id::text, c.user_id::text, u.full_name AS user_name,
             c.body, c.created_at
      FROM task.task_comments c
      JOIN iam.users u ON u.id = c.user_id
      WHERE c.task_id = ${taskId} AND c.org_id = ${ctx.org_id}
      ORDER BY c.created_at ASC
    `)) as unknown as Row[];
  });
}

// ── STATUS HISTORY ────────────────────────────────────────────────────────────
export async function listStatusHistory(ctx: TaskCtx, taskId: string) {
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(sql`
      SELECT h.id::text, h.task_id::text,
             h.old_status_id::text, os.name AS old_status_name, os.label AS old_status_label,
             h.new_status_id::text, ns.name AS new_status_name, ns.label AS new_status_label,
             h.changed_by_id::text, u.full_name AS changed_by_name,
             h.note, h.changed_at
      FROM task.task_status_log h
      LEFT JOIN task.task_statuses os ON os.id = h.old_status_id
      JOIN      task.task_statuses ns ON ns.id = h.new_status_id
      LEFT JOIN iam.users u ON u.id = h.changed_by_id
      WHERE h.task_id = ${taskId} AND h.org_id = ${ctx.org_id}
      ORDER BY h.changed_at ASC
    `)) as unknown as Row[];
  });
}

export type { DrizzleTx };
