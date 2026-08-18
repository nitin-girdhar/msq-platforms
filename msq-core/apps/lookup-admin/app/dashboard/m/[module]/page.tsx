import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, PageBody } from '@platform/ui-kit';
import { MODULES, tablesByModule, type ModuleKey } from '@/src/lib/lookupTableConfig';

interface PageProps {
  params: Promise<{ module: string }>;
}

function isModuleKey(value: string): value is ModuleKey {
  return MODULES.some((m) => m.key === value);
}

// Users isn't a lookup table (it's its own hand-built screen at
// /dashboard/users backed by @/src/lib/api/client's `users` resource), but it
// belongs with the other platform-wide entities in the nav.
const EXTRA_CARDS: Partial<Record<ModuleKey, { slug: string; title: string; description: string; href: string }[]>> = {
  platform: [
    {
      slug: 'users',
      title: 'Users',
      description: 'Platform users, roles, and organization access.',
      href: '/dashboard/users',
    },
    {
      slug: 'catalog-drift',
      title: 'Catalog Versions',
      description: 'Which tenants are behind the current default catalog version.',
      href: '/dashboard/catalogs',
    },
  ],
  capabilities: [
    {
      slug: 'capability-matrix',
      title: 'Capability Matrix',
      description: 'Grant or revoke capabilities for a role, per tenant.',
      href: '/dashboard/capabilities/matrix',
    },
  ],
};

export default async function ModulePage({ params }: PageProps) {
  const { module } = await params;
  if (!isModuleKey(module)) notFound();

  const def = MODULES.find((m) => m.key === module)!;
  const tables = tablesByModule(module);
  const extraCards = EXTRA_CARDS[module] ?? [];
  const cardCount = tables.length + extraCards.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={def.label} subtitle={`${cardCount} table${cardCount === 1 ? '' : 's'} · ${def.description}`} />
      <PageBody>
        {cardCount === 0 ? (
          <p className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 text-sm text-[#64748B]">
            Nothing configured in this module yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {extraCards.map((c) => (
              <Link
                key={c.slug}
                href={c.href}
                className="flex flex-col gap-2 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm transition-colors hover:border-[#0b6cbf] hover:bg-[#F0F9FF]"
              >
                <h2 className="text-sm font-semibold text-[#0F172A]">{c.title}</h2>
                <p className="text-xs text-[#64748B]">{c.description}</p>
              </Link>
            ))}
            {tables.map((t) => (
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
        )}
      </PageBody>
    </div>
  );
}
