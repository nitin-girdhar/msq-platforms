// @platform/ui-kit/shell — the shared app chrome (navbar, sidebars, product
// switcher, user/branch menus) used by every product web app (lms/hr/todo).
// Product-agnostic: nav entries, product origins, home targets, and any
// product-specific UI (e.g. the LMS notification bell) come in as props/slots.
// Kept behind its own subpath so the primitives barrel stays lean.

export { default as AppNavbar } from './AppNavbar';
export { default as AppSidebar } from './AppSidebar';
export { default as MobileSidebar, toggleSidebar, setSidebar } from './MobileSidebar';
export { default as HamburgerButton } from './HamburgerButton';
export { default as ProductSwitcher } from './ProductSwitcher';
export { default as UserMenu } from './UserMenu';
export { default as BranchSwitcher } from './BranchSwitcher';
export { filterNav, type NavItem } from './nav';
