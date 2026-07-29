import { fetchWithTimeout, UpstreamTimeoutError } from '@platform/http';
import { config } from '../config/index.js';
import { BadRequestError } from './errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'] ?? '';

export interface ReassignOrgLeadsParams {
  orgId: string;
  fromUserId: string;
  toUserId: string;
  actorId: string;
}

// Identity owns the identity change (org/role/active-state); leads-service
// owns the lead data (N-5) — leads-service physically can't reach lms.* after
// D8 grants, so this is a synchronous reassign-then-move saga: leads-service
// reassigns and confirms before the caller commits the org/role change.
export async function reassignOrgLeadsViaLeadsService(params: ReassignOrgLeadsParams): Promise<number> {
  // This call is the confirm step of a saga: the caller only commits the org/role
  // change once leads-service reports the leads reassigned. A hang here therefore
  // held an open DB transaction on the identity side for as long as it lasted.
  // The budget is the most generous in the platform because the reassign can
  // touch many rows — but it is bounded, and a timeout aborts the saga rather
  // than leaving the two sides to diverge.
  let response: Response;
  try {
    response = await fetchWithTimeout(`${config.leadsServiceUrl}/api/v1/internal/leads/reassign-org`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({
        org_id: params.orgId,
        from_user_id: params.fromUserId,
        to_user_id: params.toUserId,
        actor_id: params.actorId,
      }),
      timeoutMs: config.leadsServiceTimeoutMs,
      target: 'leads-service/reassign-org',
    });
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      throw new BadRequestError(
        'Lead reassignment timed out. The branch change was not applied — please retry.',
      );
    }
    throw new BadRequestError('Could not reach the leads service to reassign leads');
  }

  const body = (await response.json().catch(() => null)) as { success?: boolean; data?: { reassigned_count?: number }; error?: string } | null;
  if (!response.ok || !body?.success) {
    throw new BadRequestError(body?.error ?? 'Failed to reassign leads');
  }
  return body.data?.reassigned_count ?? 0;
}
