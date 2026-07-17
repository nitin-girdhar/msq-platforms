import { sql } from 'drizzle-orm';
import { withServiceTx } from './transaction.js';

// Recipient allowlisting for the public comms API: every email/phone must
// resolve to a CRM user OR a lead within the caller's tenant. This prevents the
// CRM being used as an open relay to arbitrary addresses.

function toTextArrayLiteral(items: string[]): string {
  return `{${items.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`;
}

function uniq(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

// Compare phones on their last 10 digits so country-code / formatting
// differences (e.g. +91 98765 43210 vs 9876543210) still match.
function last10(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.slice(-10);
}

export interface UnknownRecipients {
  emails: string[];
  phones: string[];
}

/**
 * Returns the subset of recipients that do NOT resolve to a user or lead in the
 * tenant. An empty result means every recipient is allowed.
 */
export async function findUnknownRecipients(
  tenantId: string,
  emailsIn: string[],
  phonesIn: string[],
): Promise<UnknownRecipients> {
  const emails = uniq(emailsIn.map((e) => e.toLowerCase().trim()));
  const phoneMap = new Map<string, string>(); // last10 -> original
  for (const p of phonesIn) {
    const key = last10(p);
    if (key.length === 10) phoneMap.set(key, p);
  }
  const phoneKeys = [...phoneMap.keys()];

  if (emails.length === 0 && phoneKeys.length === 0) {
    return { emails: [], phones: [] };
  }

  return withServiceTx(async (tx) => {
    const knownEmails = new Set<string>();
    if (emails.length > 0) {
      const rows = (await tx.execute(sql`
        SELECT DISTINCT e FROM (
          SELECT LOWER(u.email) AS e
          FROM iam.users u JOIN entity.organizations o ON o.id = u.org_id
          WHERE o.tenant_id = ${tenantId}::uuid AND NOT u.is_deleted AND u.email IS NOT NULL
          UNION ALL
          SELECT LOWER(l.email)
          FROM crm.marketing_leads l JOIN entity.organizations o2 ON o2.id = l.org_id
          WHERE o2.tenant_id = ${tenantId}::uuid AND NOT l.is_deleted AND l.email IS NOT NULL
        ) x
        WHERE e = ANY(${toTextArrayLiteral(emails)}::text[])
      `)) as unknown as Array<{ e: string }>;
      for (const r of rows) knownEmails.add(r.e);
    }

    const knownPhones = new Set<string>();
    if (phoneKeys.length > 0) {
      const rows = (await tx.execute(sql`
        SELECT DISTINCT p FROM (
          SELECT RIGHT(regexp_replace(u.mobile, '\\D', '', 'g'), 10) AS p
          FROM iam.users u JOIN entity.organizations o ON o.id = u.org_id
          WHERE o.tenant_id = ${tenantId}::uuid AND NOT u.is_deleted AND u.mobile IS NOT NULL
          UNION ALL
          SELECT RIGHT(regexp_replace(l.phone, '\\D', '', 'g'), 10)
          FROM crm.marketing_leads l JOIN entity.organizations o2 ON o2.id = l.org_id
          WHERE o2.tenant_id = ${tenantId}::uuid AND NOT l.is_deleted AND l.phone IS NOT NULL
        ) x
        WHERE p = ANY(${toTextArrayLiteral(phoneKeys)}::text[])
      `)) as unknown as Array<{ p: string }>;
      for (const r of rows) knownPhones.add(r.p);
    }

    return {
      emails: emails.filter((e) => !knownEmails.has(e)),
      phones: phoneKeys.filter((k) => !knownPhones.has(k)).map((k) => phoneMap.get(k)!),
    };
  });
}
