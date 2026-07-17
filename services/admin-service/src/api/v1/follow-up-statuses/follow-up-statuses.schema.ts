import { z } from 'zod';

export const createFollowUpStatusSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateFollowUpStatusSchema = createFollowUpStatusSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateFollowUpStatusInput = z.infer<typeof createFollowUpStatusSchema>;
export type UpdateFollowUpStatusInput = z.infer<typeof updateFollowUpStatusSchema>;
