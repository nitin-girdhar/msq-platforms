import { CAPABILITY } from '@platform/rbac';
import type { NavGroup } from '@platform/ui-kit/shell';

// One nav entry per admin screen. Every entry's page node is already covered
// by the layout's rank floor (org_admin+, see app/dashboard/layout.tsx); the
// capability gate below decides which SCREENS a given org/tenant admin role
// actually sees, same two-layer model every other product app uses.
//
// Team has no dedicated capability node — identity-service's user-management
// endpoints gate on rank alone (see USER_MGMT_MIN_RANK / RANKS.ADMIN in
// users.controller.ts), not a capability key. platform.write is the closest
// stand-in: every role that can act as an admin here already holds it, and
// `exact: true` is required because it's an operation leaf, not a page node
// (holdsUsableNode() would otherwise demand a granted descendant that doesn't
// exist for an operation, hiding the item from everyone).
export const ADMIN_NAV: NavGroup[] = [
  {
    id: 'admin',
    label: 'Admin',
    items: [
      {
        id: 'team',
        label: 'Team',
        href: '/dashboard/team',
        capability: CAPABILITY.PLATFORM_WRITE,
        exact: true,
      },
      {
        id: 'api-tokens',
        label: 'API Tokens',
        href: '/dashboard/api-tokens',
        capability: CAPABILITY.PLATFORM_API_TOKENS,
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
