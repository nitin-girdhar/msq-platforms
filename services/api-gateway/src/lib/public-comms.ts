import type { FastifyRequest, FastifyReply } from 'fastify';
import { findKnownUserContacts, uniqContacts, last10Digits } from '@crm/db';
import { config } from '../config.js';

interface CommsBody {
  email_addresses?: string[];
  cc?: string[];
  bcc?: string[];
  phone_numbers?: string[];
  template_name?: string;
}

interface KnownLeadContactsResponse {
  success: boolean;
  data?: { known_emails: string[]; known_phone_keys: string[] };
}

// Recipient allowlisting for the public comms API: every email/phone must
// resolve to a platform user OR an LMS lead in the caller's tenant. This
// prevents the platform being used as an open relay to arbitrary addresses.
// Checks the platform (iam.users) side locally and asks leads-service for the
// LMS-lead side (P-1/D8 — the gateway is shared and cannot read
// lms.marketing_leads directly).
async function findUnknownLeadContacts(
  tenantId: string,
  emails: string[],
  phoneKeys: string[],
): Promise<{ emails: string[]; phoneKeys: string[] }> {
  if (emails.length === 0 && phoneKeys.length === 0) return { emails: [], phoneKeys: [] };

  const response = await fetch(`${config.leadsServiceUrl}/api/v1/internal/leads/known-contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': config.serviceSecret,
    },
    body: JSON.stringify({ tenant_id: tenantId, emails, phone_keys: phoneKeys }),
  });

  const body = (await response.json().catch(() => null)) as KnownLeadContactsResponse | null;
  if (!response.ok || !body?.success || !body.data) {
    // Fail closed: if leads-service can't confirm a recipient, treat it as unknown
    // rather than silently allowing it through.
    return { emails, phoneKeys };
  }
  const knownEmails = new Set(body.data.known_emails);
  const knownPhoneKeys = new Set(body.data.known_phone_keys);
  return {
    emails: emails.filter((e) => !knownEmails.has(e)),
    phoneKeys: phoneKeys.filter((k) => !knownPhoneKeys.has(k)),
  };
}

/**
 * Guard for POST /public/v1/communications/send. Runs after publicApiKeyAuth
 * (which has set request.publicClient). Enforces two locked decisions:
 *   1. Free-form content (email, or WhatsApp without a template) requires the
 *      additive `comms:send:adhoc` scope.
 *   2. Every recipient must resolve to a platform user or LMS lead in the key's tenant.
 */
export async function publicCommsGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const client = request.publicClient!;
  const body = (request.body ?? {}) as CommsBody;

  const emailsIn = [...(body.email_addresses ?? []), ...(body.cc ?? []), ...(body.bcc ?? [])];
  const phonesIn = body.phone_numbers ?? [];

  if (emailsIn.length === 0 && phonesIn.length === 0) {
    return reply.status(400).send({ error: 'At least one recipient (email or phone) is required' });
  }

  // Emails are always free-form (no email templates); WhatsApp is free-form
  // unless a template_name is given.
  const isFreeform = emailsIn.length > 0 || (phonesIn.length > 0 && !body.template_name);
  if (isFreeform && !client.scopes.includes('comms:send:adhoc')) {
    return reply.status(403).send({
      error: 'Free-form messages require the comms:send:adhoc scope. Use an approved WhatsApp template, or request ad-hoc access.',
    });
  }

  const emails = uniqContacts(emailsIn.map((e) => e.toLowerCase().trim()));
  const phoneMap = new Map<string, string>(); // last10 -> original
  for (const p of phonesIn) {
    const key = last10Digits(p);
    if (key.length === 10) phoneMap.set(key, p);
  }
  const phoneKeys = [...phoneMap.keys()];

  const known = await findKnownUserContacts(client.tenant_id, emails, phoneKeys);
  const remainingEmails = emails.filter((e) => !known.emails.has(e));
  const remainingPhoneKeys = phoneKeys.filter((k) => !known.phoneKeys.has(k));

  const unknown = await findUnknownLeadContacts(client.tenant_id, remainingEmails, remainingPhoneKeys);

  if (unknown.emails.length > 0 || unknown.phoneKeys.length > 0) {
    return reply.status(400).send({
      error: 'All recipients must be existing users or leads in your tenant.',
      unknown_recipients: {
        emails: unknown.emails,
        phones: unknown.phoneKeys.map((k) => phoneMap.get(k)!),
      },
    });
  }
}
