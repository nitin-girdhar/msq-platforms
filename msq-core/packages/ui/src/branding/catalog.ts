import type { NavIconName } from '../shell/NavIcon';
import type { BrandTermKey } from './types';

// What a tenant admin may rename on the Branding page. Labels/icons only:
// overrides are keyed by these nav ids, which must match each product's own
// nav config (msq-lms/apps/lms-web, msq-hrms/apps/hr-web, msq-todo/apps/todo-web
// src/config/navigation.ts, admin-web src/config/navigation.ts). A product nav
// item missing here is simply not renameable — nothing breaks.
export interface BrandableNavItem {
  id: string;
  label: string;
  icon: NavIconName;
}

export const BRANDABLE_NAV: ReadonlyArray<{ product: string; label: string; items: readonly BrandableNavItem[] }> = [
  {
    product: 'lms',
    label: 'Lead Management',
    items: [
      { id: 'leads', label: 'Leads', icon: 'handshake' },
      { id: 'follow-ups', label: 'Follow-ups', icon: 'calendar-clock' },
      { id: 'assignments', label: 'Assignments', icon: 'user-check' },
      { id: 'bulk-assign', label: 'Bulk Assign', icon: 'fan-out' },
      { id: 'analytics', label: 'Analytics', icon: 'chart-column' },
      { id: 'leads-history', label: 'Leads History', icon: 'history' },
    ],
  },
  {
    product: 'hr',
    label: 'People & Attendance',
    items: [
      { id: 'attendance', label: 'Attendance', icon: 'clock' },
      { id: 'leave', label: 'Leave', icon: 'plane' },
      { id: 'employees', label: 'Employees', icon: 'id-card' },
      { id: 'reports', label: 'Reports', icon: 'chart-column' },
    ],
  },
  {
    product: 'task',
    label: 'Tasks',
    items: [{ id: 'tasks', label: 'Tasks', icon: 'square-check-big' }],
  },
];

/** Term rows: singular + plural key per word, with the platform's own words. */
export const BRAND_TERM_ROWS: ReadonlyArray<{
  singular: BrandTermKey;
  plural: BrandTermKey;
  label: string;
  pluralLabel: string;
  example: string;
}> = [
  { singular: 'lead', plural: 'leads', label: 'Lead', pluralLabel: 'Leads', example: 'Leads Pipeline, Add New Lead' },
  { singular: 'counselor', plural: 'counselors', label: 'Counselor', pluralLabel: 'Counselors', example: 'Assigned counselor' },
  { singular: 'follow_up', plural: 'follow_ups', label: 'Follow-up', pluralLabel: 'Follow-ups', example: 'Overdue follow-ups' },
  { singular: 'branch', plural: 'branches', label: 'Branch', pluralLabel: 'Branches', example: 'All branches' },
  { singular: 'assignment', plural: 'assignments', label: 'Assignment', pluralLabel: 'Assignments', example: 'Bulk assignment' },
  { singular: 'walk_in', plural: 'walk_ins', label: 'Walk-in', pluralLabel: 'Walk-ins', example: 'New walk-in lead' },
];
