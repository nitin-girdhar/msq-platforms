import { sql } from 'drizzle-orm';
import { withServiceTx, withRoleTx, type RoleTxContext } from '@crm/db';

export const ACTIVITY_ACTIONS = [
  'login_success',
  'login_failure',
  'logout',
  'user_created',
  'user_updated',
  'user_deactivated',
  'user_reactivated',
  'user_password_reset',
  'password_reset_by_admin',
  'password_changed_self',
  'role_changed',
  'privilege_denied_attempt',
  'assignment_created',
  'assignment_reassigned',
  'assignment_removed',
  'assignment_weights_updated',
  'status_change',
  'lead_created',
  'lead_transferred',
  'lead_deleted',
  'interaction_created',
  'follow_up_created',
  'follow_up_updated',
  'follow_up_deleted',
  'sheet_assigned',
  'sheet_unassigned',
  'api_client_created',
  'api_client_rotated',
  'api_client_revoked',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface LogActivityInput {
  action_type: ActivityAction | string;
  performed_by?: string | null;
  subject_user_id?: string | null;
  lead_id?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  org_id?: string | null;
}

// Fire-and-forget: audit logging must never block or fail the caller's request,
// so failures are swallowed here rather than thrown (matches the previous
// activities-service behaviour, which was also best-effort over HTTP).
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const meta: Record<string, unknown> = {};
    if (input.subject_user_id) meta['subject_user_id'] = input.subject_user_id;
    if (input.lead_id) meta['lead_id'] = input.lead_id;
    if (input.old_value !== undefined) meta['old_value'] = input.old_value;
    if (input.new_value !== undefined) meta['new_value'] = input.new_value;

    const targetId = input.lead_id ?? input.subject_user_id ?? null;
    const targetType = input.lead_id ? 'lead' : input.subject_user_id ? 'user' : null;

    await withServiceTx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO audit.activities (action_type, performed_by, target_id, target_type, org_id, meta)
        VALUES (
          ${input.action_type},
          ${input.performed_by ? sql`${input.performed_by}::uuid` : sql`NULL`},
          ${targetId},
          ${targetType},
          ${input.org_id ? sql`${input.org_id}::uuid` : sql`NULL`},
          ${JSON.stringify(meta)}::jsonb
        )
      `);
    });
  } catch (err) {
    console.error('[audit-log] Failed to record activity:', (err as Error).message, input.action_type);
  }
}

// Reads as the caller's own role (app_user/tenant_admin/super_admin) via
// withRoleTx so the org_isolation_policy/tenant_isolation_policy RLS policies
// on audit.activities actually scope the result — never bypass RLS for reads.
export async function listActivities(ctx: RoleTxContext): Promise<Array<Record<string, unknown>>> {
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(sql`
      SELECT id, action_type, performed_by, target_id, target_type, meta, created_at
      FROM audit.activities
      ORDER BY created_at DESC
      LIMIT 100
    `)) as Array<Record<string, unknown>>;
  });
}
