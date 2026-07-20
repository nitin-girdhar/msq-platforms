export {};

declare module 'fastify' {
  interface FastifyRequest {
    // P1.3: communication is a stateless relay — no rank is resolved. `role`
    // carries platform_role (used only to build the provider context).
    auth: {
      org_id: string;
      user_id: string;
      role: string;
      tenant_id: string;
    };
  }
}
