// @platform/ui-kit/shell — the shared app chrome (navbar, sidebars, product
// switcher, user/branch menus) used by every web app: the product apps
// (lms/hr/todo) and the two capability-gated consoles (admin-web, lookup-admin).
// Product-agnostic: nav entries, product origins, home targets, and any
// app-specific UI (the LMS notification bell, lookup-admin's tenant/org scope
// selectors) come in as props/slots. AppNavbar is the ONLY header — an app that
// hand-rolls its own loses the responsive rules and overflows on mobile.
// Kept behind its own subpath so the primitives barrel stays lean.

export { default as AppNavbar } from './AppNavbar';
export { default as AppSidebar } from './AppSidebar';
export { default as MobileSidebar, toggleSidebar, setSidebar } from './MobileSidebar';
export { default as HamburgerButton } from './HamburgerButton';
export { default as ProductSwitcher } from './ProductSwitcher';
export { default as UserMenu } from './UserMenu';
export { default as BranchSwitcher } from './BranchSwitcher';
export { filterNav, filterNavGroups, holdsUsableNode, isNavGroups, type NavItem, type NavGroup } from './nav';
export { usableProducts, landingFor, productHref, PRODUCT_LANDING } from './products';
