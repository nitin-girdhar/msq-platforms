import { z } from 'zod';

export const createOrgTypeSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateOrgTypeSchema = createOrgTypeSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateOrgTypeInput = z.infer<typeof createOrgTypeSchema>;
export type UpdateOrgTypeInput = z.infer<typeof updateOrgTypeSchema>;
