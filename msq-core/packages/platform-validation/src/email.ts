import { z } from 'zod';

// Canonical email handling, shared by the login lookup and the user write path.
// The same reasoning as phone.ts, one column over: iam.users.email is the
// primary login credential, so every writer MUST store the same spelling of an
// address or the credential stops identifying one person.

/**
 * Reduces an email to its canonical stored form: trimmed and lowercased.
 *
 * Case is not part of the address for our purposes -- one person typing
 * `John@x.com` and `john@x.com` means one account -- but iam.users.email is a
 * plain TEXT UNIQUE, and that is case-SENSITIVE. Without normalization the two
 * spellings are two rows, so the second one is created silently instead of
 * raising a 409, and whoever was stored as `John@x.com` cannot sign in as
 * `john@x.com`. Both the write path and the login lookup therefore go through
 * here. Keep in sync with the chk_users_email_lowercase CHECK in
 * db_scripts/02_tables_core.sql.
 *
 * Deliberately case + whitespace only: no dot-stripping, no plus-tag removal.
 * Those are provider-specific (Gmail) and would silently merge addresses that
 * are genuinely distinct subscribers everywhere else.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * The write-path field for iam.users.email: normalizes on the way in so an
 * address can never reach the column in a non-canonical spelling.
 *
 * `.trim()` runs before `.email()` so a pasted address carrying trailing
 * whitespace validates instead of failing as malformed.
 */
export const emailInputSchema = z.string().trim().email().transform(normalizeEmail);
