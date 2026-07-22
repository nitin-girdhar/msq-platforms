import type { DatabaseUser, SessionUser } from '@platform/types';
import type { UserRole } from '@platform/auth-constants';
import { capabilitiesFor } from '@platform/db';

export type { DatabaseUser, SessionUser };

/**
 * Tier C3 — the session carries the user's DB-resolved capability keys, so every
 * product UI gates tabs and tools on data instead of a hard-coded rank. Async
 * because it reads the capability matrix; that read is served from the in-process
 * cache (@platform/db startCapabilityCache), so it is not a per-call round trip.
 */
export async function sessionUserWithCapabilities(row: DatabaseUser): Promise<SessionUser> {
  return toSessionUser(row, await capabilitiesFor(row.tenant_id, row.role_name));
}

export function toSessionUser(row: DatabaseUser, capabilities: string[] = []): SessionUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role_name as UserRole,
    rank: row.rank,
    org_id: row.org_id,
    org_name: row.org_name,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    role_label: row.role_label,
    name: row.full_name,
    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,
    manager_id: row.manager_id,
    manager_name: row.manager_name,
    last_login_at: row.last_login_at ? new Date(row.last_login_at as unknown as string).toISOString() : null,
    mobile: row.mobile,
    is_active: row.is_active,
    force_password_change: row.force_password_change,
    capabilities,
  };
}
