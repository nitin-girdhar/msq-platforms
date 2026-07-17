import { z } from 'zod';

export const getOrgsQuerySchema = z.object({
  cityIds:    z.string().optional().transform((v: string | undefined) => v ? v.split(',').map(Number).filter(Boolean) : []),
  stateIds:   z.string().optional().transform((v: string | undefined) => v ? v.split(',').map(Number).filter(Boolean) : []),
  countryIds: z.string().optional().transform((v: string | undefined) => v ? v.split(',').map(Number).filter(Boolean) : []),
});

export type GetOrgsQuery = z.infer<typeof getOrgsQuerySchema>;

// Minimal org update: only the attendance geofence centre (geo_lat/geo_lng).
export const updateOrgGeoSchema = z
  .object({
    geo_lat: z.number().min(-90).max(90).nullable().optional(),
    geo_lng: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine((v) => v.geo_lat !== undefined || v.geo_lng !== undefined, {
    message: 'Provide geo_lat and/or geo_lng',
  });

export type UpdateOrgGeoInput = z.infer<typeof updateOrgGeoSchema>;
