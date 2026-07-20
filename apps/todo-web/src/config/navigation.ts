import { ROLES } from '@platform/auth-constants';
import type { NavItem } from '@platform/ui-kit/shell';

// Task product nav. The team view is role-gated inside the page; the top rail
// carries the single Tasks entry that everyone with the module sees.
export const TASK_NAV: readonly NavItem[] = [
  { id: 'tasks', label: 'Tasks', href: '/tasks', roles: ROLES },
] as const;
