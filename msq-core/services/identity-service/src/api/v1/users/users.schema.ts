import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(500).default(100),
  org_id:    z.string().uuid().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const getAssignableQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  // 'delegation' (default): candidates strictly below the actor's rank — the
  // CRM semantics for handing a lead down the hierarchy.
  // 'collaboration': candidates at or below the actor's rank, including the
  // actor themselves — used by Tasks so a member can assign to same-rank peers
  // and to themselves.
  scope: z.enum(['delegation', 'collaboration']).default('delegation'),
});

export type GetAssignableQuery = z.infer<typeof getAssignableQuerySchema>;
