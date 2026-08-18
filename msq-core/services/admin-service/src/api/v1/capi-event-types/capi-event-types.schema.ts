import { z } from 'zod';

export const createCapiEventTypeSchema = z.object({
  code: z.string().min(1).max(50).trim(),
  label: z.string().min(1).max(100).trim(),
  description: z.string().trim().optional(),
  sort_order: z.number().int().optional(),
});

export const updateCapiEventTypeSchema = createCapiEventTypeSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateCapiEventTypeInput = z.infer<typeof createCapiEventTypeSchema>;
export type UpdateCapiEventTypeInput = z.infer<typeof updateCapiEventTypeSchema>;
