import { sql } from 'drizzle-orm';
import { withServiceTx } from './transaction.js';

// Recipient allowlisting for the public comms API: every email/phone must
// resolve to a platform user (checked here) OR a product-owned contact record
// (e.g. an LMS lead — checked by the owning product service; see P-1/D8).
// This prevents the platform being used as an open relay to arbitrary
// addresses. This module only knows about iam.users — the shared, platform-
// owned side of that check; @crm/db must not query a product schema
// (lms.marketing_leads) directly post-D8-grants.

export function toTextArrayLiteral(items: string[]): string {
  return `{${items.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`;
}

export function uniqContacts(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

// Compare phones on their last 10 digits so country-code / formatting
// differences (e.g. +91 98765 43210 vs 9876543210) still match.
export function last10Digits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.slice(-10);
}

export interface KnownContacts {
  emails: Set<string>;
  phoneKeys: Set<string>;
}

/**
 * Returns the subset of the given (already-normalized) emails/phone-keys that
 * resolve to an active platform user in the tenant.
 */
export async function findKnownUserContacts(
  tenantId: string,
  emails: string[],
  phoneKeys: string[],
): Promise<KnownContacts> {
  return withServiceTx(async (tx) => {
    const knownEmails = new Set<string>();
    if (emails.length > 0) {
      const rows = (await tx.execute(sql`
        SELECT DISTINCT LOWER(u.email) AS e
        FROM iam.users u JOIN entity.organizations o ON o.id = u.org_id
        WHERE o.tenant_id = ${tenantId}::uuid AND NOT u.is_deleted AND u.email IS NOT NULL
          AND LOWER(u.email) = ANY(${toTextArrayLiteral(emails)}::text[])
      `)) as unknown as Array<{ e: string }>;
      for (const r of rows) knownEmails.add(r.e);
    }

    const knownPhones = new Set<string>();
    if (phoneKeys.length > 0) {
      const rows = (await tx.execute(sql`
        SELECT DISTINCT RIGHT(regexp_replace(u.mobile, '\\D', '', 'g'), 10) AS p
        FROM iam.users u JOIN entity.organizations o ON o.id = u.org_id
        WHERE o.tenant_id = ${tenantId}::uuid AND NOT u.is_deleted AND u.mobile IS NOT NULL
          AND RIGHT(regexp_replace(u.mobile, '\\D', '', 'g'), 10) = ANY(${toTextArrayLiteral(phoneKeys)}::text[])
      `)) as unknown as Array<{ p: string }>;
      for (const r of rows) knownPhones.add(r.p);
    }

    return { emails: knownEmails, phoneKeys: knownPhones };
  });
}
