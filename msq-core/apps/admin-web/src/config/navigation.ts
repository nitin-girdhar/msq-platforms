import { CAPABILITY } from '@platform/rbac';
import type { NavGroup } from '@platform/ui-kit/shell';

// One nav entry per admin screen, each gated on its own page node under the
// `admin` tool — this console's namespace since the split that moved the
// platform-operator keys to `superadmin.*` (see @platform/rbac).
//
// This list is now load-bearing twice over: it decides which screens render in
// the rail, AND — via filterNavGroups in app/dashboard/layout.tsx — whether the
// console opens at all. An entry with no reachable capability makes the console
// invisible to that role rather than showing them an empty shell.
//
// No `exact: true` on these: they are page nodes with operations beneath them,
// so holdsUsableNode() is the right question (granted, AND something granted
// below it). `exact` exists for operation leaves, which have no descendants and
// would otherwise be hidden from everyone.
export const ADMIN_NAV: NavGroup[] = [
  {
    id: 'admin',
    label: 'Admin',
    items: [
      {
        id: 'team',
        label: 'Team',
        href: '/dashboard/team',
        capability: CAPABILITY.ADMIN_TEAM,
      },
      {
        id: 'api-tokens',
        label: 'API Tokens',
        href: '/dashboard/api-tokens',
        capability: CAPABILITY.ADMIN_API_TOKENS,
      },
      {
        id: 'leave-admin',
        label: 'Leave',
        href: '/dashboard/leave/admin',
        capability: CAPABILITY.HR_LEAVE_ADMIN,
      },
      {
        id: 'attendance-admin',
        label: 'Attendance',
        href: '/dashboard/attendance/admin',
        capability: CAPABILITY.HR_ATTENDANCE_ADMIN,
      },
    ],
  },
];
