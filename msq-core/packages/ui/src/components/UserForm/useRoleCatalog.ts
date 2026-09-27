'use client';

import { useEffect, useState } from 'react';
import { users as usersApi } from '../../api/resources';
import { useUserAdminScope } from '../../providers/UserAdminScope';
import type { DepartmentOption, RoleOption } from './types';

interface RoleCatalog {
  roles: RoleOption[];
  departments: DepartmentOption[];
  loading: boolean;
  error: string | null;
}

/**
 * The roles this actor may grant, fetched once per mounted form.
 *
 * The server has already capped the list at the actor's own rank, so anything
 * returned here is grantable by definition — the caller never re-checks rank.
 */
export function useRoleCatalog(enabled = true): RoleCatalog {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // lookup-admin's selected tenant, when set — its roles, not the session's.
  const { tenant_id: scopeTenantId } = useUserAdminScope();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    setLoading(true);
    usersApi.roleCatalog({ tenant_id: scopeTenantId })
      .then((res) => {
        if (cancelled) return;
        setRoles(res.data.roles);
        setDepartments(res.data.departments);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load roles.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled, scopeTenantId]);

  return { roles, departments, loading, error };
}
