import { redirect } from 'next/navigation';
import Link from 'next/link';
import { InfoTip, PageBody, PageHeader } from '@platform/ui-kit';
import { NavIcon, filterNavGroups } from '@platform/ui-kit/shell';
import { getServerSession } from '@/src/lib/server-session';
import { ADMIN_NAV } from '@/src/config/navigation';

// One description per nav item id — kept separate from ADMIN_NAV since the
// sidebar has no use for blurb copy. The card list itself is DERIVED from
// ADMIN_NAV (filtered the same way the sidebar filters it) rather than a
// second hard-coded array, so a tile can never show here for a capability
// the actor doesn't hold — that gap previously left every tile, including
// API Tokens, visible to anyone who could reach /dashboard, only to 403
// on click-through.
const DESCRIPTIONS: Record<string, string> = {
  team: 'Add, edit, and manage your organization’s users.',
  'api-tokens': 'Issue and rotate machine credentials for integrations.',
  'leave-admin': 'Policies, holidays, and leave cycle configuration.',
  'attendance-admin': 'Shifts, rules, and attendance reports.',
  branding: 'Company colours and font, terms, and menu labels & icons.',
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const cards = filterNavGroups(ADMIN_NAV, result.session).flatMap((group) => group.items);

  return (
    <>
      <PageHeader title="Admin" info="Manage your team, API tokens, and HR admin settings." />
      <PageBody dense>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {cards.map((card) => (
            // The (i) sits beside the link, not inside it: a button nested in an anchor is invalid
            // and would navigate on tap.
            <div key={card.href} className="relative">
            <Link
              href={card.href}
              className="group flex min-h-[3.25rem] items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 pr-10 shadow-sm transition-colors hover:border-primary/40 hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-on-primary-container">
                {card.icon && <NavIcon name={card.icon} className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <h2 className="text-body-lg font-semibold text-on-surface">{card.label}</h2>
              </span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </Link>
            <InfoTip label={`About ${card.label}`} className="absolute right-9 top-1/2 -translate-y-1/2">{DESCRIPTIONS[card.id]}</InfoTip>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}
