import type { UserRole } from '@crm/auth-constants';

// A single sidebar/nav entry. Each product app owns its own list of these (LMS
// leads/follow-ups/…, HR leave/attendance, Task tasks) and passes it into the
// shared chrome — the chrome itself carries no product knowledge.
export interface NavItem {
  id: string;
  label: string;
  href: string;
  roles: readonly UserRole[];
}

// Filter a product's nav list down to what the acting role may see. Frontend
// convenience only — the gateway + RLS remain the real access boundary.
export function filterNavByRole(items: readonly NavItem[], role: UserRole): NavItem[] {
  return items.filter((item) => item.roles.includes(role));
}
