import { PageTabs, type PageTab } from '@platform/ui-kit';

// The Meta pipeline reads left to right in the order an operator works it:
// connect the app → register portfolios & datasets → discover accounts → map pages to
// branches → classify campaigns → pull missed leads → clear what could not land →
// watch the conversion events go back. Routes are unchanged; only the strip grows.
const META_TABS: readonly PageTab[] = [
  { href: '/dashboard/meta-connection', label: 'Connection' },
  { href: '/dashboard/meta-datasets', label: 'Datasets' },
  { href: '/dashboard/meta-ad-accounts', label: 'Ad Accounts' },
  { href: '/dashboard/meta-mappings', label: 'Page Mapping' },
  { href: '/dashboard/meta-campaigns', label: 'Campaign Mapping & Rules' },
  { href: '/dashboard/lead-pull', label: 'Meta Lead Pull' },
  { href: '/dashboard/meta-lead-inbox', label: 'Lead Review Inbox' },
  { href: '/dashboard/capi-outbox', label: 'CAPI Outbox' },
];

export default function MetaTabs() {
  return <PageTabs tabs={META_TABS} label="Meta pipeline" />;
}
