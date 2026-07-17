// @crm/ui — cross-module, presentation-level primitives shared by every apps/web
// module (CRM today; Leave/Attendance/Tasks later). Consumed as TypeScript
// source via Next.js `transpilePackages` (see apps/web/next.config.js) — no
// separate build step. Never add domain-specific (CRM, HR, ...) knowledge here.

export { Modal } from './components/Modal';
export { Pagination } from './components/Pagination';
export { DownloadButton, type ExportFormat } from './components/DownloadButton';
export { Placeholder } from './components/Placeholder';
export { MonthGrid, type MonthGridBar, type MonthGridMarker } from './components/MonthGrid';

export { useIsMobile } from './hooks/useIsMobile';
export { useDismissible, useDropdown } from './hooks/useDropdown';

export { createApiClient, type ApiRequestError } from './api/http';
