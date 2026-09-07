import { z } from 'zod';
import { emailInputSchema } from './email.js';
import { mobileInputSchema } from './phone.js';

// One branch a user works in: which org, in which role, at what share of that
// branch's incoming leads. Maps 1:1 onto a row of iam.user_org_mapping.
//
// role_id, not role_name: roles are tenant-owned and a tenant may define its own
// department-scoped roles, so a name is only unique once you know the tenant.
// The id is unambiguous and is what the role-catalog endpoint hands the UI.
export const orgAssignmentSchema = z.object({
  org_id: z.string().uuid(),
  role_id: z.string().uuid(),
  lead_assignment_weight: z.number().int().min(0).max(100).optional(),
});

// Shared by create and update. `home_org_id` is iam.users.org_id — the user's
// primary branch — and must be one of the branches they were actually given.
function refineOrgAssignments<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (v: { org_assignments?: unknown[] }) => {
        const list = v.org_assignments as Array<{ org_id: string }> | undefined;
        if (!list) return true;
        return new Set(list.map((a) => a.org_id)).size === list.length;
      },
      { message: 'Each branch may appear only once', path: ['org_assignments'] },
    )
    .refine(
      (v: { org_assignments?: unknown[]; home_org_id?: string }) =>
        !v.org_assignments || v.home_org_id !== undefined,
      { message: 'home_org_id is required when org_assignments is given', path: ['home_org_id'] },
    )
    .refine(
      (v: { org_assignments?: unknown[]; home_org_id?: string }) => {
        const list = v.org_assignments as Array<{ org_id: string }> | undefined;
        if (!list || v.home_org_id === undefined) return true;
        return list.some((a) => a.org_id === v.home_org_id);
      },
      { message: 'home_org_id must be one of the selected branches', path: ['home_org_id'] },
    );
}

export const createUserSchema = refineOrgAssignments(
  z.object({
    first_name: z.string().min(1).max(50),
    middle_name: z.string().max(50).optional(),
    last_name: z.string().max(50).optional(),
    email: emailInputSchema,
    mobile: mobileInputSchema.optional(),
    // Legacy single-branch path: the user lands in the actor's own org with this
    // role. Superseded by org_assignments when that is present — kept because
    // lookup-admin's create form still posts role_name alone.
    role_name: z.string().optional(),
    manager_id: z.string().uuid().optional(),
    force_password_change: z.boolean().optional(),
    // Email the new user their login details + temporary password. Undefined is
    // treated as true in the service (the admin opted in by default); the send
    // is additionally gated on the actor holding admin.team.notify.
    send_email_notification: z.boolean().optional(),
    org_assignments: z.array(orgAssignmentSchema).min(1).optional(),
    home_org_id: z.string().uuid().optional(),
  }).refine(
    (v) => v.role_name !== undefined || v.org_assignments !== undefined,
    { message: 'Either role_name or org_assignments is required', path: ['role_name'] },
  ),
);

export const updateUserSchema = refineOrgAssignments(
  z.object({
    first_name: z.string().min(1).max(50).optional(),
    middle_name: z.string().max(50).optional(),
    last_name: z.string().max(50).optional(),
    email: emailInputSchema.optional(),
    mobile: mobileInputSchema.optional(),
    role_name: z.string().optional(),
    manager_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
    force_password_change: z.boolean().optional(),
    // Email the user when this edit changes their branch access / home branch.
    // Undefined is treated as true in the service; the send is additionally
    // gated on the actor holding admin.team.notify and on a branch actually
    // having changed (a plain profile edit sends nothing).
    send_email_notification: z.boolean().optional(),
    // Legacy single-branch move. When org_assignments is present the home branch
    // comes from home_org_id instead and this is ignored.
    org_id: z.string().uuid().optional(),
    reassign_leads_to: z.string().uuid().nullable().optional(),
    org_assignments: z.array(orgAssignmentSchema).min(1).optional(),
    home_org_id: z.string().uuid().optional(),
  }),
);

// Only shape/length-bounds are enforced here — the real strength policy (and
// the tenant-wide-role override of it) is enforced in the service, which
// knows the actor's role and the override_policy flag.
export const resetPasswordSchema = z.object({
  new_password: z.string().min(1).max(128).optional(),
  override_policy: z.boolean().optional(),
  // Whether the target must pick a new password at next login. Defaults to true
  // in the service — an admin handing out a temporary password is the norm —
  // but an admin who deliberately set a final password can send false.
  force_password_change: z.boolean().optional(),
  // Email the user that their password was reset. Undefined is treated as true
  // in the service; the send is additionally gated on the actor holding
  // admin.team.notify. The temporary password is included only when it was
  // system-generated (new_password absent).
  send_email_notification: z.boolean().optional(),
});

export const updateAssignmentWeightsSchema = z.object({
  weights: z.array(z.object({
    user_id: z.string().uuid(),
    weight: z.number().int().min(0).max(100),
  })).min(1),
});

export const addOrgMappingSchema = z.object({
  org_id: z.string().uuid(),
  role_id: z.string().uuid(),
  lead_assignment_weight: z.number().int().min(0).max(100).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type OrgAssignmentInput = z.infer<typeof orgAssignmentSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateAssignmentWeightsInput = z.infer<typeof updateAssignmentWeightsSchema>;
export type AddOrgMappingInput = z.infer<typeof addOrgMappingSchema>;
