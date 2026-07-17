import Link from 'next/link';
import { TABLE_CONFIG } from '@/src/lib/lookupTableConfig';

interface MasterDataCard {
  slug: string;
  title: string;
  description: string;
  href: string;
}

const MASTER_DATA_CARDS: MasterDataCard[] = [
  {
    slug: 'tenants',
    title: 'Tenants',
    description: 'Top-level tenant accounts on the platform.',
    href: '/dashboard/lookups/tenants',
  },
  {
    slug: 'organizations',
    title: 'Organizations',
    description: 'Branches/locations under a tenant.',
    href: '/dashboard/lookups/organizations',
  },
  {
    slug: 'users',
    title: 'Users',
    description: 'Platform users, roles, and organization access.',
    href: '/dashboard/users',
  },
];

// The lookup tables extended in this task (tenants, organizations) live in
// TABLE_CONFIG and are rendered under Master Data instead of Lookup Tables —
// exclude their slugs from the generic lookup-tables grid so they aren't
// listed twice.
const MASTER_DATA_SLUGS = new Set(MASTER_DATA_CARDS.map((c) => c.slug));

export default function DashboardPage() {
  const lookupTables = Object.values(TABLE_CONFIG).filter((t) => !MASTER_DATA_SLUGS.has(t.slug));

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Lookup Tables</h1>
          <p className="mt-1 text-xs text-[#64748B]">
            {lookupTables.length} tables · super admin scope
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lookupTables.map((t) => (
            <Link
              key={t.slug}
              href={`/dashboard/lookups/${t.slug}`}
              className="flex flex-col gap-2 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm transition-colors hover:border-[#0b6cbf] hover:bg-[#F0F9FF]"
            >
              <h2 className="text-sm font-semibold text-[#0F172A]">{t.title}</h2>
              <p className="text-xs text-[#64748B]">{t.description}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Master Data</h1>
          <p className="mt-1 text-xs text-[#64748B]">
            {MASTER_DATA_CARDS.length} sections · tenants, organizations, and users
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MASTER_DATA_CARDS.map((c) => (
            <Link
              key={c.slug}
              href={c.href}
              className="flex flex-col gap-2 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm transition-colors hover:border-[#0b6cbf] hover:bg-[#F0F9FF]"
            >
              <h2 className="text-sm font-semibold text-[#0F172A]">{c.title}</h2>
              <p className="text-xs text-[#64748B]">{c.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
