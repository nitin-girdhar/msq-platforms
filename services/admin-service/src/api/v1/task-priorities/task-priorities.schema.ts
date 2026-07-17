import { z } from 'zod';

export const createTaskPrioritySchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
  sort_order: z.number().int().default(0),
});

export const updateTaskPrioritySchema = createTaskPrioritySchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateTaskPriorityInput = z.infer<typeof createTaskPrioritySchema>;
export type UpdateTaskPriorityInput = z.infer<typeof updateTaskPrioritySchema>;
