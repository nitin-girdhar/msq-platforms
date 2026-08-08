import { redirect } from 'next/navigation';
import Link from 'next/link';
import { filterNavGroups } from '@platform/ui-kit/shell';
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
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const cards = filterNavGroups(ADMIN_NAV, result.session).flatMap((group) => group.items);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Admin</h1>
      <p className="mt-1 text-sm text-[#64748B]">
        Manage your team, API tokens, and HR admin settings.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm transition-colors hover:border-[#0b6cbf]/40 hover:bg-[#F8FAFC]"
          >
            <h2 className="text-sm font-semibold text-[#0F172A]">{card.label}</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{DESCRIPTIONS[card.id]}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
