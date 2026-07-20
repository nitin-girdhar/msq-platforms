import { z } from 'zod';

export const createUserRoleSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
  rank: z.number().int().min(0).max(100),
});

export const updateUserRoleSchema = createUserRoleSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateUserRoleInput = z.infer<typeof createUserRoleSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
