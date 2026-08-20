import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(500).default(100),
  org_id:    z.string().uuid().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const getAssignableQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  // Multi-branch variant of org_id, for a list that spans several orgs at once —
  // the Leads History org filter is multi-select, and forwarding only the
  // single-org case silently collapsed its user list to the actor's home branch.
  // Comma-separated uuids; each is uuid-checked here so a malformed id is a 400
  // rather than a query that quietly matches nothing. Still ignored entirely for
  // an actor with no cross-org reach — see getAssignableUsers in the service.
  org_ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).nonempty().optional()),
  // 'delegation' (default): candidates strictly below the actor's rank — the
  // CRM semantics for handing a lead down the hierarchy.
  // 'collaboration': candidates at or below the actor's rank, including the
  // actor themselves — used by Tasks so a member can assign to same-rank peers
  // and to themselves.
  scope: z.enum(['delegation', 'collaboration']).default('delegation'),
  // Overrides `scope` entirely when present: candidates at or below this
  // absolute rank, regardless of the actor's own rank. Used where the ceiling
  // is a fixed business rule rather than relative to the actor (e.g. bulk
  // lead assignment, which only ever targets individual contributors).
  max_rank: z.coerce.number().int().nonnegative().optional(),
  // Which product the candidates must actually have access to, gated on the
  // matching CAPABILITY tool node (see @platform/rbac). The rank ladder in
  // iam.user_roles is shared platform-wide and tenant admins can create
  // arbitrary custom roles on it (e.g. "Fitness Trainer"), so rank alone does
  // not mean "this user is provisioned for this product" — a caller must say
  // which product it's asking for. Required, not defaulted: an endpoint that
  // silently fell back to "no product filter" would reintroduce the exact bug
  // this field exists to close.
  product: z.enum(['lms', 'tasks']),
  // What the candidate list is FOR, which decides whether `scope`/`max_rank`
  // above are honored at all.
  //
  // 'assign' (default) + product 'lms': the server ignores both and derives the
  // ceiling from the actor's own lms.leads.assign.reports/.peers/.any grants,
  // so the picker matches exactly what canAssignToUser (leads-service) and
  // iam.can_assign_to (the PATCH path) will actually permit. A picker that
  // offers a name the write then rejects is the render-then-403 bug the
  // capability model exists to prevent, and a client-supplied `scope` cannot
  // know the actor's grants.
  //
  // 'filter': this list populates a FILTER, not an assignee picker. It answers
  // "who works leads in this branch", so it drops the assign ladder entirely:
  // no ceiling relative to the actor (that hid every assignee at or above them
  // from a grid that shows those names in every row) and no derivation from
  // lms.leads.assign.* grants (that emptied the filter for a role which can
  // read a wide history but may assign to nobody).
  //
  // What it keeps is the same eligibility rule getAssignmentWeights uses: the
  // absolute rank band above read_only and below org_admin, AND the lms.leads
  // capability — the TOOL node, not the `lms` product root. Both are load
  // bearing: the capability drops hr_admin and the fitness roles, the band
  // drops super_admin and read_only. Accepts org_ids for a multi-branch filter.
  purpose: z.enum(['assign', 'filter']).default('assign'),
});

export type GetAssignableQuery = z.infer<typeof getAssignableQuerySchema>;

// Profile-photo upload. `photo` is a base64 payload (optionally a data: URI);
// the byte cap is re-checked after decode. `consent` is the user's DPDP
// attestation that this image may be stored and used for face attendance — the
// service rejects a false/absent consent with 422.
// ~2.9M base64 chars ≈ 2.1 MiB decoded, a hair above the 2 MiB byte cap so the
// decoded-size check (not this one) is what rejects an oversize image.
const PHOTO_MAX_B64_CHARS = 2_900_000;

// Both new lookups are scoped to one branch. org_id is optional and defaults to
// the actor's own org; the service checks it belongs to the actor's tenant.
export const orgScopedQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
});

export type OrgScopedQuery = z.infer<typeof orgScopedQuerySchema>;

export const uploadPhotoSchema = z.object({
  photo: z.string().min(1).max(PHOTO_MAX_B64_CHARS),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  consent: z.boolean(),
});

export type UploadPhotoInput = z.infer<typeof uploadPhotoSchema>;
