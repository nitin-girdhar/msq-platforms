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

export const switchOrgSchema = z.object({
  org_id: z.string().uuid('Invalid organization id'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SwitchOrgInput = z.infer<typeof switchOrgSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
