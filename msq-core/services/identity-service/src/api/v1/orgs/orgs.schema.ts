import { z } from 'zod';

// geo.* PKs are UUID v7 now (db_scripts/02_tables_core.sql), so these are
// comma-separated uuids rather than ints. Non-uuid entries are dropped rather
// than rejected, matching the previous filter(Boolean) behaviour — and it
// matters here because the repository interpolates the result into a ::uuid[].
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidCsv = z
  .string()
  .optional()
  .transform((v: string | undefined) =>
    v ? v.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)) : [],
  );

export const getOrgsQuerySchema = z.object({
  cityIds:    uuidCsv,
  stateIds:   uuidCsv,
  countryIds: uuidCsv,
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
