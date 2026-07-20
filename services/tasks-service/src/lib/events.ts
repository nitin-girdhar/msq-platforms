import { pgNotify } from '@platform/db';

// ─────────────────────────────────────────────────────────────────────────────
// In-app notifications for task events. Reuses the existing notifications
// pathway (identical to hr-service's leave events): we publish to the Postgres
// `crm_events` NOTIFY channel and notifications-service (PgNotifyTransport)
// LISTENs and fans out over SSE. Its connection-manager delivers an event to a
// non-admin client only when the client's org matches AND the client is the
// event's `assigned_user_id` or `actor_id`, so we set `assigned_user_id` to the
// intended recipient (the assignee) to route it correctly.
//
//   task:assigned → sent to the assignee when a task is assigned to someone
//                   other than the actor (creation or reassignment).
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL = 'crm_events';

export type TaskEventType = 'task:assigned';

interface TaskEventInput {
  type: TaskEventType;
  task_id: string;
  recipient_id: string;
  org_id: string;
  tenant_id: string;
  actor_id: string;
}

// Fire-and-forget: a notification failure must never fail the task operation
// that triggered it (the DB transaction has already committed).
export async function publishTaskEvent(input: TaskEventInput): Promise<void> {
  try {
    await pgNotify(CHANNEL, {
      type: input.type,
      // Shaped to satisfy the existing broadcaster's routing/security filter.
      lead_id: input.task_id,
      org_id: input.org_id,
      tenant_id: input.tenant_id,
      assigned_user_id: input.recipient_id,
      actor_id: input.actor_id,
      ts: Date.now(),
    });
  } catch (err) {
    console.error('[tasks-service] publishTaskEvent failed:', (err as Error).message, input.type);
  }
}
