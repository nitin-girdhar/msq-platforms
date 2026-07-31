export {};

declare module 'fastify' {
  interface FastifyRequest {
    auth: {
      org_id: string;
      user_id: string;
      /** platform_role — the 4-value denormalisation of the user's GLOBAL role
       *  (super_admin/tenant_admin/org_admin/member). Drives withRoleTx's PG-role
       *  selection for RLS and the cross-org `role === 'super_admin'` checks.
       *  NOT a key into the capability matrix — see role_name. */
      role: string;
      /** iam.user_roles.name for this user's role IN THIS ORG, from
       *  iam.fn_user_org_role — the same value /auth/me and every product
       *  service resolve capabilities against. Null when the user has no active
       *  role in the org. */
      role_name: string | null;
      tenant_id: string;
      rank: number;
    };
  }
}
