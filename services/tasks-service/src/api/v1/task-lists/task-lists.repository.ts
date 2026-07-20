// ─────────────────────────────────────────────────────────────────────────────
// Task-lists repository — all DB access for task.task_lists.
//
// Conventions (mirroring services/hr-service leave.repository):
//   - Own-scope reads run in withRoleTx so task.* RLS scopes them (org isolation
//     + the owner-private rule on task_lists).
//   - team/org-scope reads run in withServiceTx (BYPASSRLS) after an app-layer
//     rank check, and are ALWAYS explicitly scoped by the gateway-verified org_id
//     — never a client-supplied id. `team` visibility (owner's subtree) is not
//     expressible as a single-row RLS predicate, so it is applied here in SQL via
//     iam.vw_user_team_members. See Architecture.md "Tasks".
//   - Writes run in withRoleTx (app_user) so the standard triggers capture the
//     acting user; ownership/rank authorization is enforced in the service layer.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx, type RoleTxContext, type DrizzleTx } from '@platform/db';
import type { CreateTaskListInput, UpdateTaskListInput, ListTaskListsInput } from '@task/validation';

export type TaskCtx = RoleTxContext & { rank: number };
type Row = Record<string, unknown>;

const SELECT = sql`
  tl.id::text, tl.org_id::text, tl.name, tl.description, tl.owner_id::text,
  uo.full_name AS owner_name, tl.visibility, tl.is_active, tl.created_at, tl.updated_at
`;
const FROM = sql`
  FROM task.task_lists tl
  JOIN iam.users uo ON uo.id = tl.owner_id
`;

// True when `memberId` sits under `managerId` in the org's management subtree.
export async function isManagerOf(ctx: TaskCtx, managerId: string, memberId: string | null): Promise<boolean> {
  if (!memberId) return false;
  if (managerId === memberId) return false;
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT 1 FROM iam.vw_user_team_members
      WHERE manager_id = ${managerId} AND member_id = ${memberId} AND org_id = ${ctx.org_id}
      LIMIT 1
    `)) as unknown as Row[];
    return rows.length > 0;
  });
}

export async function listTaskLists(ctx: TaskCtx, filters: ListTaskListsInput) {
  const { page, limit, scope } = filters;
  const offset = (page - 1) * limit;
  const me = ctx.user_id;

  // Scope predicate. `own` runs under RLS (withRoleTx); `team`/`org` run in the
  // service tx with explicit org scoping.
  if (scope === 'own') {
    return withRoleTx(ctx, async (tx) => {
      const where = sql`WHERE tl.org_id = ${ctx.org_id} AND NOT tl.is_deleted AND tl.owner_id = ${me}`;
      const rows = (await tx.execute(sql`
        SELECT ${SELECT} ${FROM} ${where}
        ORDER BY tl.name LIMIT ${limit} OFFSET ${offset}
      `)) as unknown as Row[];
      const countRows = (await tx.execute(sql`
        SELECT COUNT(*)::int AS count ${FROM} ${where}
      `)) as unknown as Array<{ count: number }>;
      return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
    });
  }

  return withServiceTx(async (tx) => {
    const scopeClause =
      scope === 'org'
        ? // Whole org, but others' private lists stay hidden even from admins.
          sql`AND (tl.visibility <> 'private' OR tl.owner_id = ${me})`
        : // team: lists I own, org-wide lists, or team lists whose owner's subtree
          // I belong to (or that I own).
          sql`AND (
            tl.owner_id = ${me}
            OR tl.visibility = 'org'
            OR (tl.visibility = 'team' AND (
              tl.owner_id = ${me}
              OR EXISTS (SELECT 1 FROM iam.vw_user_team_members m
                         WHERE m.manager_id = tl.owner_id AND m.member_id = ${me} AND m.org_id = ${ctx.org_id})
            ))
          )`;
    const where = sql`WHERE tl.org_id = ${ctx.org_id} AND NOT tl.is_deleted ${scopeClause}`;
    const rows = (await tx.execute(sql`
      SELECT ${SELECT} ${FROM} ${where}
      ORDER BY tl.name LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Row[];
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count ${FROM} ${where}
    `)) as unknown as Array<{ count: number }>;
    return { data: rows, total: countRows[0]?.count ?? 0, page, limit };
  });
}

// Raw row (service scope) used by both the read path and the visibility check.
export interface TaskListRow {
  id: string;
  org_id: string;
  owner_id: string;
  visibility: 'private' | 'team' | 'org';
  name: string;
}

export async function getTaskListRow(ctx: TaskCtx, id: string): Promise<TaskListRow | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id::text, org_id::text, owner_id::text, visibility, name
      FROM task.task_lists
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `)) as unknown as TaskListRow[];
    return rows[0] ?? null;
  });
}

export async function getTaskListView(ctx: TaskCtx, id: string): Promise<Row | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ${SELECT} ${FROM}
      WHERE tl.id = ${id} AND tl.org_id = ${ctx.org_id} AND NOT tl.is_deleted
    `)) as unknown as Row[];
    return rows[0] ?? null;
  });
}

export async function createTaskList(ctx: TaskCtx, data: CreateTaskListInput): Promise<{ id: string }> {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      INSERT INTO task.task_lists (org_id, name, description, owner_id, visibility, created_by)
      VALUES (${ctx.org_id}, ${data.name}, ${data.description ?? null}, ${ctx.user_id}, ${data.visibility}, ${ctx.user_id})
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    return { id: rows[0]!.id };
  });
}

export async function updateTaskList(ctx: TaskCtx, id: string, data: UpdateTaskListInput): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    const sets: ReturnType<typeof sql>[] = [];
    if (data.name !== undefined) sets.push(sql`name = ${data.name}`);
    if (data.description !== undefined) sets.push(sql`description = ${data.description}`);
    if (data.visibility !== undefined) sets.push(sql`visibility = ${data.visibility}`);
    if (data.is_active !== undefined) sets.push(sql`is_active = ${data.is_active}`);
    if (sets.length === 0) return;
    await tx.execute(sql`
      UPDATE task.task_lists SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `);
  });
}

// Soft-delete the list and detach its tasks (set list_id NULL). The FK is
// ON DELETE SET NULL for the hard-delete path; because we soft-delete (UPDATE),
// we replicate that detach explicitly in the same transaction.
export async function softDeleteTaskList(ctx: TaskCtx, id: string): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE task.task_lists
      SET is_deleted = TRUE, is_active = FALSE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = ${ctx.user_id}
      WHERE id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `);
    await tx.execute(sql`
      UPDATE task.tasks SET list_id = NULL
      WHERE list_id = ${id} AND org_id = ${ctx.org_id} AND NOT is_deleted
    `);
  });
}

export type { DrizzleTx };
