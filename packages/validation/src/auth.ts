import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  org_id: z.string().uuid().optional(),
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
