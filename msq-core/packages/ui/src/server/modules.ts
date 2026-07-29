const GATEWAY_URL = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';

// Every platform module is gated by entity.tenant_modules — including 'lms',
// which used to be assumed present for every tenant. That assumption was wrong
// the moment an HRMS-only tenant existed: it asserted a CRM entitlement nobody
// had bought, which the gateway then 403'd. There is no default product.
//
// Sourced from hr-service's GET /hr/modules, which reads the caller's tenant
// from the gateway-verified session, never a client-supplied id.
export type PlatformModule = 'lms' | 'leave' | 'attendance' | 'tasks';

const GATED_MODULES: readonly PlatformModule[] = ['lms', 'leave', 'attendance', 'tasks'];

function isGatedModule(value: string): value is PlatformModule {
  return (GATED_MODULES as readonly string[]).includes(value);
}

// Fetches the tenant's enabled modules once per authenticated request (called
// from Server Components — dashboard/leave/attendance/tasks layouts). On any
// failure, fail closed to NOTHING enabled rather than exposing ungated modules.
export async function getEnabledModules(cookieHeader: string): Promise<PlatformModule[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/hr/modules`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data: { modules: string[] } };
    return data.data.modules.filter(isGatedModule);
  } catch {
    return [];
  }
}
