import { z } from 'zod';

// Canonical mobile-number handling, shared by the login lookup and the user
// write path. Both MUST go through normalizeMobile: iam.users.mobile carries a
// partial unique index on the normalized value, so a raw write would let two
// spellings of one number land on separate rows and make login-by-mobile
// ambiguous. Keep this in sync with the SQL normalization in
// db_scripts/02_schema.sql.

// India-first: a bare 10-digit number is assumed +91. Anything arriving with an
// explicit '+' keeps its own country code, so other countries already work
// without a per-country table. Widen DEFAULT_COUNTRY_CODE (or move to
// libphonenumber-js) if a second home market ever needs the bare-digit default.
const DEFAULT_COUNTRY_CODE = '91';

// Indian mobile numbers are 10 digits starting 6-9; landlines and short codes
// are deliberately excluded -- this column is a login credential, not a contact
// field, so anything we cannot pin to one subscriber is rejected.
const INDIAN_MOBILE = /^[6-9][0-9]{9}$/;

// Loose E.164 bound: 1-3 digit country code + subscriber number, 8-15 total.
const E164 = /^\+[1-9][0-9]{7,14}$/;

/**
 * Reduces user input to canonical E.164 ('+919876543210'), or null when the
 * input cannot be read as a mobile number.
 *
 * Null is a rejection, not an error: the auth path turns it into the same
 * generic "invalid credentials" as any other failed lookup (no enumeration
 * signal), while the user-write path turns it into a 400.
 */
export function normalizeMobile(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith('+');
  // Separators people actually type: spaces, hyphens, parens, dots.
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return null;

  if (hadPlus) {
    const candidate = `+${digits}`;
    return E164.test(candidate) ? candidate : null;
  }

  // Trunk prefix: '09876543210' is the same subscriber as '9876543210'.
  const local = digits.replace(/^0+/, '');

  if (INDIAN_MOBILE.test(local)) return `+${DEFAULT_COUNTRY_CODE}${local}`;

  // Already carries the country code but was typed without the '+'.
  if (
    local.startsWith(DEFAULT_COUNTRY_CODE) &&
    INDIAN_MOBILE.test(local.slice(DEFAULT_COUNTRY_CODE.length))
  ) {
    return `+${local}`;
  }

  return null;
}

/**
 * Whether a login identifier should be resolved as a mobile number rather than
 * an email. Deliberately cheap and total: the absence of '@' is what routes an
 * identifier here, and normalizeMobile makes the final call on validity.
 */
export function isMobileLike(input: string): boolean {
  return !input.includes('@');
}

/**
 * The write-path field for iam.users.mobile: normalizes on the way in so a
 * number can never reach the column in a non-canonical spelling, and rejects
 * with a 400 when it is not a usable mobile number.
 *
 * Empty string and null both mean "clear it" and become NULL. That matters
 * beyond ergonomics: the column's unique index treats '' as an ordinary value,
 * so letting blanks through would make the SECOND user who submits an empty
 * mobile collide with the first.
 */
export const mobileInputSchema = z
  .union([z.string().max(20), z.null()])
  .transform((value, ctx) => {
    if (value === null || value.trim() === '') return null;
    const normalized = normalizeMobile(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid mobile number (10 digits, or with a country code)',
      });
      return z.NEVER;
    }
    return normalized;
  });
