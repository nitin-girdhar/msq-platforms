import Link from 'next/link';

const CARDS = [
  { href: '/dashboard/team', label: 'Team', description: 'Add, edit, and manage your organization’s users.' },
  { href: '/dashboard/api-tokens', label: 'API Tokens', description: 'Issue and rotate machine credentials for integrations.' },
  { href: '/dashboard/leave/admin', label: 'Leave', description: 'Policies, holidays, and leave cycle configuration.' },
  { href: '/dashboard/attendance/admin', label: 'Attendance', description: 'Shifts, rules, and attendance reports.' },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Admin</h1>
      <p className="mt-1 text-sm text-[#64748B]">
        Manage your team, API tokens, and HR admin settings.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm transition-colors hover:border-[#0b6cbf]/40 hover:bg-[#F8FAFC]"
          >
            <h2 className="text-sm font-semibold text-[#0F172A]">{card.label}</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
