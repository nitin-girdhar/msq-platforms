import { z } from 'zod';
import { strongPassword, createStrongPasswordSchema, DEFAULT_PASSWORD_MIN_LENGTH } from './auth.js';

export const createUserSchema = z.object({
  first_name: z.string().min(1).max(50),
  middle_name: z.string().max(50).optional(),
  last_name: z.string().max(50).optional(),
  email: z.string().email(),
  mobile: z.string().max(20).optional(),
  role_name: z.string(),
  manager_id: z.string().uuid().optional(),
  force_password_change: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  first_name: z.string().min(1).max(50).optional(),
  middle_name: z.string().max(50).optional(),
  last_name: z.string().max(50).optional(),
  email: z.string().email().optional(),
  mobile: z.string().max(20).optional(),
  role_name: z.string().optional(),
  manager_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  force_password_change: z.boolean().optional(),
  org_id: z.string().uuid().optional(),
  reassign_leads_to: z.string().uuid().optional(),
});

export function createResetPasswordSchema(minLength: number = DEFAULT_PASSWORD_MIN_LENGTH) {
  return z.object({
    new_password: createStrongPasswordSchema(minLength).optional(),
  });
}

export const resetPasswordSchema = z.object({
  new_password: strongPassword.optional(),
});

export const updateAssignmentWeightsSchema = z.object({
  weights: z.array(z.object({
    user_id: z.string().uuid(),
    weight: z.number().int().min(0).max(100),
  })).min(1),
});

export const addOrgMappingSchema = z.object({
  org_id: z.string().uuid(),
  role_id: z.string().uuid(),
  lead_assignment_weight: z.number().int().min(0).max(100).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateAssignmentWeightsInput = z.infer<typeof updateAssignmentWeightsSchema>;
export type AddOrgMappingInput = z.infer<typeof addOrgMappingSchema>;
