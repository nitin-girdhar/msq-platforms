import { z } from 'zod';

export const createInteractionTypeSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateInteractionTypeSchema = createInteractionTypeSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateInteractionTypeInput = z.infer<typeof createInteractionTypeSchema>;
export type UpdateInteractionTypeInput = z.infer<typeof updateInteractionTypeSchema>;
