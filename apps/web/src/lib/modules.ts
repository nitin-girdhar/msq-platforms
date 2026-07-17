const GATEWAY_URL = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';

// 'crm' is the original product and is always available — only the newer
// platform modules are gated via entity.tenant_modules (see hr-service's
// GET /hr/modules, which reads the caller's tenant from the gateway-verified
// session, never a client-supplied id).
export type PlatformModule = 'crm' | 'leave' | 'attendance' | 'tasks';

const GATED_MODULES: readonly PlatformModule[] = ['leave', 'attendance', 'tasks'];

function isGatedModule(value: string): value is PlatformModule {
  return (GATED_MODULES as readonly string[]).includes(value);
}

// Fetches the tenant's enabled modules once per authenticated request (called
// from Server Components — dashboard/leave/attendance/tasks layouts). On any
// failure, fail closed to CRM-only rather than exposing ungated modules.
export async function getEnabledModules(cookieHeader: string): Promise<PlatformModule[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/hr/modules`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return ['crm'];
    const data = (await res.json()) as { data: { modules: string[] } };
    const gated = data.data.modules.filter(isGatedModule);
    return ['crm', ...gated];
  } catch {
    return ['crm'];
  }
}
