import type { FastifyRequest, FastifyReply } from 'fastify';
import { findUnknownRecipients } from '@crm/db';

interface CommsBody {
  email_addresses?: string[];
  cc?: string[];
  bcc?: string[];
  phone_numbers?: string[];
  template_name?: string;
}

/**
 * Guard for POST /public/v1/communications/send. Runs after publicApiKeyAuth
 * (which has set request.publicClient). Enforces two locked decisions:
 *   1. Free-form content (email, or WhatsApp without a template) requires the
 *      additive `comms:send:adhoc` scope.
 *   2. Every recipient must resolve to a CRM user or lead in the key's tenant.
 */
export async function publicCommsGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const client = request.publicClient!;
  const body = (request.body ?? {}) as CommsBody;

  const emails = [...(body.email_addresses ?? []), ...(body.cc ?? []), ...(body.bcc ?? [])];
  const phones = body.phone_numbers ?? [];

  if (emails.length === 0 && phones.length === 0) {
    return reply.status(400).send({ error: 'At least one recipient (email or phone) is required' });
  }

  // Emails are always free-form (no email templates); WhatsApp is free-form
  // unless a template_name is given.
  const isFreeform = emails.length > 0 || (phones.length > 0 && !body.template_name);
  if (isFreeform && !client.scopes.includes('comms:send:adhoc')) {
    return reply.status(403).send({
      error: 'Free-form messages require the comms:send:adhoc scope. Use an approved WhatsApp template, or request ad-hoc access.',
    });
  }

  const unknown = await findUnknownRecipients(client.tenant_id, emails, phones);
  if (unknown.emails.length > 0 || unknown.phones.length > 0) {
    return reply.status(400).send({
      error: 'All recipients must be existing users or leads in your tenant.',
      unknown_recipients: unknown,
    });
  }
}
