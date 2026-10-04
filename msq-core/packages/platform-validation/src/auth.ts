import { z } from 'zod';

// Login accepts an email OR a mobile number in one field. `email` is retained
// as a deprecated alias so this service can ship ahead of the client repos,
// which live outside this monorepo and are released separately -- drop it once
// they all send `identifier`.
//
// Deliberately NOT validated as an email or a phone number here: the shape of
// the identifier decides which lookup runs, and a malformed one must fail as
// generic invalid credentials from the service, not as a 400 that tells an
// attacker their guess was not even a registered address format.
export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(255).optional(),
    /** @deprecated send `identifier` instead */
    email: z.string().trim().min(1).max(255).optional(),
    password: z.string().min(1, 'Password is required'),
    org_id: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.identifier ?? v.email), {
    message: 'Email or mobile number is required',
    path: ['identifier'],
  })
  .transform((v) => {
    const { email: _deprecated, ...rest } = v;
    return { ...rest, identifier: (v.identifier ?? v.email) as string };
  });

export const DEFAULT_PASSWORD_MIN_LENGTH = 12;

export function createStrongPasswordSchema(minLength: number = DEFAULT_PASSWORD_MIN_LENGTH) {
  return z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .max(128, 'Password must be at most 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number');
}

// Default-length schema, for consumers that don't need a configurable policy.
export const strongPassword = createStrongPasswordSchema();

export function createChangePasswordSchema(minLength: number = DEFAULT_PASSWORD_MIN_LENGTH) {
  return z.object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: createStrongPasswordSchema(minLength),
  });
}

export const changePasswordSchema = createChangePasswordSchema();

// Self-service reset. Email only (users sign in with email; a mobile number
// is not a reset channel). The response never says whether it matched.
export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').max(254).email('Enter a valid email'),
}).strict();

export function createSelfResetPasswordSchema(minLength: number = DEFAULT_PASSWORD_MIN_LENGTH) {
  return z.object({
    // 32 random bytes, base64url → 43 chars.
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid or expired reset link'),
    new_password: createStrongPasswordSchema(minLength),
  }).strict();
}

export const selfResetPasswordSchema = createSelfResetPasswordSchema();

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type SelfResetPasswordInput = z.infer<typeof selfResetPasswordSchema>;

// Either one branch, or "All branches" (only honoured for users whose branch
// list is the whole tenant — enforced in identity-service, not here).
// `tenant_id` with all_branches is a platform super_admin's cross-tenant
// "All branches of <tenant>"; identity-service refuses it for anyone else.
export const switchOrgSchema = z.union([
  z.object({ org_id: z.string().uuid('Invalid organization id') }).strict(),
  z.object({ all_branches: z.literal(true), tenant_id: z.string().uuid('Invalid tenant id').optional() }).strict(),
]);

export type LoginInput = z.infer<typeof loginSchema>;
export type SwitchOrgInput = z.infer<typeof switchOrgSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
