// @platform/ui-kit — cross-product, presentation-level primitives shared by
// every product web app (LMS today; HR/Task/Leave/Attendance later). Consumed
// as TypeScript source via Next.js `transpilePackages` (see apps/web/next.config.ts)
// — no separate build step. Never add domain-specific (LMS, HR, ...) knowledge
// here. Server-only helpers (session) live behind the `./server` subpath entry,
// not this client-safe barrel.

export { Modal } from './components/Modal';
export { Pagination } from './components/Pagination';
export { DownloadButton, type ExportFormat } from './components/DownloadButton';
export { Placeholder } from './components/Placeholder';
export { MonthGrid, type MonthGridBar, type MonthGridMarker } from './components/MonthGrid';
export { UserPicker } from './components/UserPicker';
export { MultiSelect, type SelectOption } from './components/MultiSelect';
export { PhotoUploadModal, PhotoAvatar, type PhotoUploadGate } from './components/PhotoUpload';

// Create/Edit user form fields. Shared because admin-web "Team" and lms-web
// "Users" are the same screen twice — they drifted apart while each app owned
// its own copy, and the branch/role/weight model is too easy to get subtly
// wrong in two places.
export {
  DepartmentSelect,
  OrgAssignmentsField,
  ManagerSelect,
  useRoleCatalog,
  useUserAssignments,
  useWeightStatus,
  rolesForDepartment,
  ALL_DEPARTMENTS,
  NO_DEPARTMENT,
  type BranchOption,
  type DepartmentOption,
  type ManagerCandidate,
  type OrgAssignment,
  type RoleOption,
  type WeightStatus,
} from './components/UserForm';
export { ErrorState, AppErrorBoundary, type ErrorStateProps, type AppErrorBoundaryProps } from './components/ErrorState';

// Page scaffold — the header band / body / section rhythm and the one button
// scale every product page is built from. Keeps HR, Tasks and LMS on identical
// gutters, type sizes and control density.
export {
  Button,
  PageHeader,
  PageTabs,
  PageBody,
  PageSection,
  Alert,
  type ButtonVariant,
  type ButtonSize,
  type PageTab,
} from './components/page';

export { useIsMobile } from './hooks/useIsMobile';
export { useDismissible, useDropdown } from './hooks/useDropdown';

export { createApiClient, type ApiRequestError } from './api/http';
export { orgs, users } from './api/resources';

export {
  exportRows,
  buildFilename,
  slugify,
  todayStamp,
  type ExportColumn,
  type ExportFormat as ExportRowsFormat,
} from './export/export';

export { NotificationProvider, useNotifications, type AppNotification } from './providers/NotificationProvider';

// SSO origin helpers — client-safe (no jose, no next/headers). Server Components
// call productOrigins()/authOrigin() and pass results down to client chrome.
export { authOrigin, adminWebOrigin, buildLoginUrl, buildChangePasswordUrl, productOrigins, allowedRedirectOrigins } from './auth/sso';

// Product entitlement resolution — tenant license INTERSECT user capability, plus
// the landing target derived from it. Pure and env-free (no React, no jose), so
// auth-web's redirect logic can import it from this barrel rather than ./shell,
// which would drag in the chrome components.
export { usableProducts, landingFor, PRODUCT_LANDING } from './shell/products';
