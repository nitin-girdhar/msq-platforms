import { CAPABILITY } from '@platform/rbac';
import type { NavGroup } from '@platform/ui-kit/shell';
import { MODULES } from '@/src/lib/lookupTableConfig';

// One nav entry per module, grouped under a single "Admin" section. The
// Capabilities entry is gated on admin.roles.manage rather than the lookups
// capability, since Workstream C wires role/capability management through a
// separate capability from the plain lookup CRUD the other modules share.
//
// The lookup modules gate on the `admin.lookups` PAGE node, not on
// admin.lookups.manage: filterNav's default rule (holdsUsableNode) requires a
// granted capability BENEATH the key, and an operation leaf has none — gating
// on the operation rendered an empty sidebar for every user, super admin
// included. admin.roles.manage has no page node above it in the seed, so it
// stays an operation and opts into the exact-match gate instead.
export const ADMIN_NAV: NavGroup[] = [
  {
    id: 'admin',
    label: 'Admin',
    items: MODULES.map((m) =>
      m.key === 'capabilities'
        ? {
            id: m.key,
            label: m.label,
            href: `/dashboard/m/${m.key}`,
            capability: CAPABILITY.ADMIN_ROLES_MANAGE,
            exact: true,
          }
        : {
            id: m.key,
            label: m.label,
            href: `/dashboard/m/${m.key}`,
            capability: CAPABILITY.ADMIN_LOOKUPS,
          },
    ),
  },
];
