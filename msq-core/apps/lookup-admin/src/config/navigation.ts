import { CAPABILITY } from '@platform/rbac';
import type { NavGroup } from '@platform/ui-kit/shell';
import { MODULES } from '@/src/lib/lookupTableConfig';

// One nav entry per module, grouped under a single "Admin" section. The
// Capabilities entry is gated on admin.roles.manage rather than
// admin.lookups.manage, since Workstream C wires role/capability management
// through a separate capability from the plain lookup CRUD the other modules
// share.
export const ADMIN_NAV: NavGroup[] = [
  {
    id: 'admin',
    label: 'Admin',
    items: MODULES.map((m) => ({
      id: m.key,
      label: m.label,
      href: `/dashboard/m/${m.key}`,
      capability: m.key === 'capabilities' ? CAPABILITY.ADMIN_ROLES_MANAGE : CAPABILITY.ADMIN_LOOKUPS_MANAGE,
    })),
  },
];
