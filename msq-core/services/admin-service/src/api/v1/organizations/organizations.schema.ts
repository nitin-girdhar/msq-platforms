import { z } from 'zod';

export const createOrganizationSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(200).trim(),
  legal_entity_name: z.string().trim().optional(),
  brand_name: z.string().trim().optional(),
  org_type_id: z.string().uuid(),
  address_line1: z.string().trim().optional(),
  address_line2: z.string().trim().optional(),
  landmark: z.string().trim().optional(),
  pincode: z.string().trim().optional(),
  // geo.* PKs are UUID v7 now (db_scripts/02_tables_core.sql), not identity ints.
  city_id: z.string().uuid().optional(),
  state_id: z.string().uuid().optional(),
  country_id: z.string().uuid().optional(),
  timezone: z.string().trim().optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
