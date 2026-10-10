'use client';

import { useMemo, type ComponentProps } from 'react';
import { TeamShell, type TeamExtraTab } from '@platform/team-web';
import { EmployeeHrSection } from '@hr/web';
import { can, CAPABILITY } from '@platform/rbac';

type Props = Omit<ComponentProps<typeof TeamShell>, 'extraTabs'>;

// Admin -> Team with the HR profile folded into the edit drawer. HR facts (employment, org placement,
// work and schedule, personal details) are edited HERE and nowhere else; HRMS Employees is a read-only
// directory. The tabs appear only for an actor holding hr.employees.manage, the same grant hr-service
// checks on every one of these writes, so a tab that shows is a tab that saves. Advisory only: the
// service is the enforcement.
export default function TeamWithHr(props: Props) {
  const canEditHr = can(props.actor, CAPABILITY.HR_EMPLOYEES_MANAGE);

  const extraTabs = useMemo<ReadonlyArray<TeamExtraTab>>(() => {
    if (!canEditHr) return [];
    return [
      { id: 'employment', label: 'Employment', render: ({ userId, isSelf }) => <EmployeeHrSection section="employment" userId={userId} isSelf={isSelf} /> },
      { id: 'org', label: 'Org placement', render: ({ userId, isSelf }) => <EmployeeHrSection section="org" userId={userId} isSelf={isSelf} /> },
      { id: 'work', label: 'Work & schedule', render: ({ userId, isSelf }) => <EmployeeHrSection section="work" userId={userId} isSelf={isSelf} /> },
      { id: 'personal', label: 'Personal', render: ({ userId, isSelf }) => <EmployeeHrSection section="personal" userId={userId} isSelf={isSelf} /> },
    ];
  }, [canEditHr]);

  return <TeamShell {...props} {...(extraTabs.length > 0 ? { extraTabs } : {})} />;
}
