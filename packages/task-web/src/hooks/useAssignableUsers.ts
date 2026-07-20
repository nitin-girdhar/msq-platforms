import { useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { users as usersApi } from '@platform/ui-kit';

// Fetches the org's assignable users once, mapped into SessionUser shape for
// UserPicker — same mapping LeadDashboardShell uses for lead assignment.
export function useAssignableUsers(): SessionUser[] {
  const [candidates, setCandidates] = useState<SessionUser[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await usersApi.assignable();
        if (cancelled) return;
        const raw = Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : [];
        setCandidates(
          raw.map((u) => ({
            ...u,
            name: (u.full_name ?? u.name ?? '') as string,
            role: (u.role_name ?? u.role ?? '') as SessionUser['role'],
            role_label: (u.role_label ?? '') as string,
            rank: Number(u.rank ?? 0),
            org_id: (u.org_id ?? '') as string,
            org_name: '',
            tenant_id: '',
            tenant_name: '',
            manager_id: null,
            manager_name: null,
            last_login_at: null,
          })) as SessionUser[],
        );
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return candidates;
}
