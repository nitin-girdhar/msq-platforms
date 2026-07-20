import { ROLE_RANK } from '@crm/auth-constants';
import type { SessionUser, UserRole } from '@crm/types';

export { RANKS, platformRank } from './ranks.js';
export * from './scope.js';
export * from './user-management.js';
export * from './product.js';

export function hasRole(session: SessionUser, role: UserRole): boolean {
  return session.role === role;
}

export function hasMinimumRole(session: SessionUser, min: UserRole): boolean {
  return session.rank >= ROLE_RANK[min];
}

export function hasAnyRole(session: SessionUser, roles: UserRole[]): boolean {
  return roles.includes(session.role);
}
