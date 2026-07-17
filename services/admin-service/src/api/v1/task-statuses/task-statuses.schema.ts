import { z } from 'zod';

export const createTaskStatusSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
  is_terminal: z.boolean().default(false),
  sort_order: z.number().int().default(0),
});

export const updateTaskStatusSchema = createTaskStatusSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateTaskStatusInput = z.infer<typeof createTaskStatusSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
