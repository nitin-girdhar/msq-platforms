import { fetchWithTimeout } from '@platform/http';
import { config } from '../config/index.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'] ?? '';

export interface SendUserEmailParams {
  // The acting admin's tenant context, forwarded so communication-service can
  // build its provider context. Never the recipient's — the recipient is `to`.
  orgId: string;
  userId: string;
  tenantId: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
}

/**
 * Fire-and-forget transactional email for a Team-management event (account
 * created, password reset, branch changed). Mirrors leads-service-client's
 * shape, but the posture is audit-log's, not the saga's: this must NEVER throw
 * or block the admin's request. A failed send is logged (user id only, never
 * the address or password) and swallowed.
 *
 * Posts to communication-service's internal-secret path — the same route the
 * gateway uses for the public partner API — so it bypasses the gateway's
 * read_only send-guard, which is correct: the caller (users.controller) has
 * already checked admin.team.notify.
 */
export async function sendUserEmail(params: SendUserEmailParams): Promise<void> {
  try {
    const response = await fetchWithTimeout(
      `${config.communicationServiceUrl}/api/v1/communications/public-send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': INTERNAL_SECRET,
          'x-org-id': params.orgId,
          'x-user-id': params.userId,
          'x-tenant-id': params.tenantId,
        },
        body: JSON.stringify({
          email_addresses: [params.to],
          subject: params.subject,
          body: params.body,
          ...(params.html ? { html: params.html } : {}),
        }),
        timeoutMs: config.communicationServiceTimeoutMs,
        target: 'communication-service/public-send',
      },
    );
    if (!response.ok) {
      console.error(
        '[identity-service] user-notification email rejected:',
        response.status,
        'recipient user unknown-by-design; no PII logged',
      );
    }
  } catch (err) {
    // Timeout, DNS, connection refused, aborted — none of it is the admin's
    // problem. The account/password/branch change already succeeded.
    console.error(
      '[identity-service] user-notification email failed:',
      (err as Error).message,
    );
  }
}
