'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ALL_DEPARTMENTS, type OrgAssignment, type RoleOption } from './types';

interface Init {
  /** Branches the user already holds. Empty for a new user. */
  assignments?: OrgAssignment[];
  homeOrgId?: string;
  managerId?: string;
  /** Branch a new user lands in when the actor cannot pick branches. */
  fallbackOrgId: string;
  roles: RoleOption[];
  rolesLoaded: boolean;
}

/**
 * The branch/role/manager half of the user form, held in one place so
 * admin-web and lms-web build an identical payload.
 *
 * `department` is UI-only state — it filters the role list and is never sent.
 * A user has no department; the role they hold has one.
 */
export function useUserAssignments({
  assignments: initialAssignments, homeOrgId: initialHome, managerId: initialManager,
  fallbackOrgId, roles, rolesLoaded,
}: Init) {
  const [departmentId, setDepartmentId] = useState<string>(ALL_DEPARTMENTS);
  const [roleId, setRoleId] = useState('');
  const [assignments, setAssignments] = useState<OrgAssignment[]>(initialAssignments ?? []);
  const [homeOrgId, setHomeOrgId] = useState(initialHome ?? '');
  const [managerId, setManagerId] = useState(initialManager ?? '');

  // The edit form's branches arrive from a fetch AFTER first render, and a
  // useState initializer only ever reads its argument once — so without this the
  // loaded set would never reach the field and every edit would save an empty
  // branch list. Seeds once per user, then leaves the admin's edits alone.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !initialAssignments) return;
    setAssignments(initialAssignments);
    if (initialHome) setHomeOrgId(initialHome);
    setSeeded(true);
  }, [seeded, initialAssignments, initialHome]);

  // Seed the top-level department/role from what the user already holds in their
  // home branch, so an edit form opens showing their actual role rather than a
  // blank select the admin must re-pick to save anything.
  useEffect(() => {
    if (!rolesLoaded || roles.length === 0) return;
    const homeRoleId = (initialAssignments ?? []).find((a) => a.org_id === initialHome)?.role_id;
    if (!homeRoleId) return;
    const role = roles.find((r) => r.id === homeRoleId);
    if (!role) return;
    setRoleId(role.id);
    if (role.department_id) setDepartmentId(role.department_id);
  }, [rolesLoaded, roles, initialAssignments, initialHome]);

  // A brand-new user with no branch yet starts in the actor's own, which is the
  // only branch a non-tenant-admin can assign anyway. Stops once real branches
  // arrive — including an empty set, which is a load failure the form must
  // surface rather than paper over with a branch the user may not hold.
  useEffect(() => {
    if (initialAssignments) return;
    if (assignments.length === 0 && fallbackOrgId) {
      setAssignments([{ org_id: fallbackOrgId, role_id: '', lead_assignment_weight: 0 }]);
      setHomeOrgId(fallbackOrgId);
    }
  }, [fallbackOrgId, assignments.length, initialAssignments]);

  // Picking a role at the top applies it to any branch row still unset — the
  // common case is one role everywhere, and making that require a second pick
  // per row would be busywork. Rows already given a role are left alone.
  const applyRole = useCallback((next: string) => {
    setRoleId(next);
    setAssignments((prev) => prev.map((a) => (a.role_id ? a : { ...a, role_id: next })));
  }, []);

  const isComplete = useMemo(
    () => assignments.length > 0
      && assignments.every((a) => a.org_id && a.role_id)
      && Boolean(homeOrgId)
      && assignments.some((a) => a.org_id === homeOrgId),
    [assignments, homeOrgId],
  );

  /** Which branch row is missing a role, for a message that names it. */
  const incompleteOrgIds = useMemo(
    () => assignments.filter((a) => !a.role_id).map((a) => a.org_id),
    [assignments],
  );

  const payload = useCallback(() => ({
    org_assignments: assignments.map((a) => ({
      org_id: a.org_id,
      role_id: a.role_id,
      lead_assignment_weight: a.lead_assignment_weight,
    })),
    home_org_id: homeOrgId,
  }), [assignments, homeOrgId]);

  const reset = useCallback(() => {
    setDepartmentId(ALL_DEPARTMENTS);
    setRoleId('');
    setAssignments(fallbackOrgId ? [{ org_id: fallbackOrgId, role_id: '', lead_assignment_weight: 0 }] : []);
    setHomeOrgId(fallbackOrgId);
    setManagerId('');
  }, [fallbackOrgId]);

  return {
    departmentId, setDepartmentId,
    roleId, setRoleId: applyRole,
    assignments, setAssignments,
    homeOrgId, setHomeOrgId,
    managerId, setManagerId,
    isComplete, incompleteOrgIds,
    payload, reset,
  };
}
