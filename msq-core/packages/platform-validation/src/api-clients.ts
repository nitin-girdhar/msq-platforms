import { z } from 'zod';
import { API_SCOPES } from '@platform/auth-constants';

export const createApiClientSchema = z.object({
  name: z.string().min(1).max(120),
  // Explicit branch bindings; omit (and leave scope_all_orgs false) for none.
  org_ids: z.array(z.string().uuid()).optional(),
  // Explicit tenant-wide binding — mutually exclusive with org_ids in practice
  // (the service ignores org_ids when this is true).
  scope_all_orgs: z.boolean().optional(),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  rate_limit_per_min: z.number().int().min(1).max(6000).optional(),
  // ISO 8601; must be in the future when supplied.
  expires_at: z.string().datetime().optional(),
});

export type CreateApiClientInput = z.infer<typeof createApiClientSchema>;

export const updateApiClientSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  scopes: z.array(z.enum(API_SCOPES)).min(1).optional(),
  org_ids: z.array(z.string().uuid()).optional(),
  scope_all_orgs: z.boolean().optional(),
  rate_limit_per_min: z.number().int().min(1).max(6000).optional(),
  // ISO 8601; null clears the expiry; must be in the future when supplied.
  expires_at: z.string().datetime().nullable().optional(),
});

export type UpdateApiClientInput = z.infer<typeof updateApiClientSchema>;
