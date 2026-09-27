import { fetchWithTimeout } from '@platform/http';
import { config } from '../config/index.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'] ?? '';

export interface SyncEmployeeProfileParams {
  userId: string;
  tenantId: string;
  homeOrgId: string;
  isActive: boolean;
  /** YYYY-MM-DD; only used when hr-service creates the profile. */
  dateOfJoining?: string | undefined;
  actorId: string;
}

// Identity owns the member (iam.users / mappings / reporting lines); hr-service
// owns hr.employee_profiles (N-5). Every HRMS attendance and leave screen reads
// that profile, so a Team-created member without one is invisible to HR.
//
// Unlike the leads reassign saga this is called AFTER identity's writes are
// done: hr-service validates the member's branch mapping on its own
// connection, which could not see an uncommitted row. So the two sides are not
// atomic, and a failure here must not undo the identity change the admin
// already made. It resolves to false instead of throwing; the caller reports it
// and a re-save (the sync is an idempotent upsert) or
// db_scripts/one_time/backfill_hr_employee_profiles.sql repairs it.
export async function syncEmployeeProfileViaHrService(
  params: SyncEmployeeProfileParams,
): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${config.hrServiceUrl}/api/v1/internal/employees/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({
        user_id: params.userId,
        tenant_id: params.tenantId,
        home_org_id: params.homeOrgId,
        is_active: params.isActive,
        ...(params.dateOfJoining ? { date_of_joining: params.dateOfJoining } : {}),
        actor_id: params.actorId,
      }),
      timeoutMs: config.hrServiceTimeoutMs,
      target: 'hr-service/employees-sync',
    });
    const body = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    if (!response.ok || !body?.success) {
      console.error(
        '[identity-service] HR profile sync rejected:',
        response.status,
        body?.error ?? 'no error body',
        'user', params.userId,
      );
      return false;
    }
    return true;
  } catch (err) {
    // Timeout, DNS, connection refused — the identity change already stands.
    console.error('[identity-service] HR profile sync failed:', (err as Error).message, 'user', params.userId);
    return false;
  }
}
