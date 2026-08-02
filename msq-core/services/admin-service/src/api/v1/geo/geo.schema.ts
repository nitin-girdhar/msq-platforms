import { z } from 'zod';

// The owning tenant arrives as the `tenant_id` QUERY param, like every other
// tenant-scoped lookup route (see user-roles.schema.ts), not in the body — and
// it is not editable on update: moving a city between tenants would orphan
// every organization and lead pointing at it.
//
// There is no delete schema. geo rows are referenced ON DELETE RESTRICT by
// entity.organizations and lms.marketing_leads, and 07_grants.sql grants no
// DELETE on geo at all — "remove this place" is PATCH { is_active: false }.

export const createCountrySchema = z.object({
  name: z.string().min(1).max(200).trim(),
  // CHAR(2) in the DDL. Upper-cased here so 'in' and 'IN' collide on the
  // (tenant_id, iso_code) unique index instead of both being stored.
  iso_code: z.string().length(2).trim().toUpperCase(),
  description: z.string().trim().optional(),
});

export const updateCountrySchema = createCountrySchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const createStateSchema = z.object({
  country_id: z.string().uuid(),
  name: z.string().min(1).max(200).trim(),
  code: z.string().max(10).trim().optional(),
  description: z.string().trim().optional(),
});

export const updateStateSchema = createStateSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const createCitySchema = z.object({
  state_id: z.string().uuid(),
  name: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateCitySchema = createCitySchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateCountryInput = z.infer<typeof createCountrySchema>;
export type UpdateCountryInput = z.infer<typeof updateCountrySchema>;
export type CreateStateInput = z.infer<typeof createStateSchema>;
export type UpdateStateInput = z.infer<typeof updateStateSchema>;
export type CreateCityInput = z.infer<typeof createCitySchema>;
export type UpdateCityInput = z.infer<typeof updateCitySchema>;
