// ── Machine vocabularies inside operator-editable lookup tables ─────────────
// Most lookup rows are pure tenant data: an operator may rename, relabel or
// deactivate them freely. A few are not — their `name` is a contract that SQL
// triggers and service code branch on, so renaming or deactivating one silently
// breaks a workflow rather than failing loudly.
//
// Those names are listed here so the admin UI can lock them and the owning
// service can re-assert the lock on write. This package is deliberately free of
// a @platform/db dependency (see product.ts), which is what lets the Next.js
// admin frontend and the Fastify services share one copy of the list instead of
// drifting apart across repos.
//
// The UI lock is a convenience. The service-side check is the boundary.

/**
 * hr.leave_request_statuses — the leave approval vocabulary.
 *
 * `hr.set_leave_request_is_open()` (db_scripts/04_functions_triggers.sql) derives
 * `is_open` from `name IN ('pending','approved')`, and hr-service resolves
 * 'pending' / 'approved' / 'rejected' / 'cancelled' by name when transitioning a
 * request (leave.repository.ts). 'draft' and 'withdrawn' complete the shipped
 * catalog (reference_data/07_catalog_registry.sql) and are reserved alongside
 * them so the set an operator sees locked matches the set the platform seeds.
 *
 * Labels and descriptions on these rows stay freely editable — only `name` and
 * `is_active` are frozen.
 */
export const RESERVED_LEAVE_REQUEST_STATUS_NAMES: readonly string[] = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'withdrawn',
];

/** True when `name` is frozen for the given lookup slug. */
export function isReservedLookupName(slug: string, name: string | null | undefined): boolean {
  if (!name) return false;
  const reserved = RESERVED_LOOKUP_NAMES[slug];
  return reserved ? reserved.includes(name) : false;
}

/** Slug → frozen names. Keyed by the lookup-admin slug, not the SQL table name. */
export const RESERVED_LOOKUP_NAMES: Readonly<Record<string, readonly string[]>> = {
  'leave-request-statuses': RESERVED_LEAVE_REQUEST_STATUS_NAMES,
};
