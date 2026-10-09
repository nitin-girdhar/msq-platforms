import { notFound } from 'next/navigation';
import { PageHeader, PageBody } from '@platform/ui-kit';
import ModuleConsole, { type ConsoleCard, type ConsoleSection } from '@/components/console/ModuleConsole';
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
  lms: [
    {
      slug: 'campaign-types',
      title: 'Campaign Types & Rules',
      description: 'Which department each campaign type routes to, and the ordered rules that type a lead from its campaign, form, ad set or ad name.',
      href: '/dashboard/campaign-types',
    },
    {
      slug: 'meta-connection',
      title: 'Meta Connection',
      description: 'The one Meta app and the two system users (leads reader, events sender) — status, scopes, expiry, rotation.',
      href: '/dashboard/meta-connection',
    },
    {
      slug: 'meta-datasets',
      title: 'Meta Datasets',
      description: 'Client business portfolios and their datasets (pixels), which ad accounts feed each, and the per-branch fallback.',
      href: '/dashboard/meta-datasets',
    },
    {
      slug: 'capi-outbox',
      title: 'CAPI Outbox',
      description: 'The lead-quality events each stage change owes Meta — sent, failed and why, parked for want of a dataset; retry or dismiss.',
      href: '/dashboard/capi-outbox',
    },
    {
      slug: 'meta-ad-accounts',
      title: 'Meta Ad Accounts',
      description: 'Ad accounts under the shared Meta integration — enable the ones "Fetch campaigns" walks.',
      href: '/dashboard/meta-ad-accounts',
    },
    {
      slug: 'meta-lead-inbox',
      title: 'Meta Lead Inbox',
      description: 'Webhook leads that could not be created (unmapped page, missing phone, errors) — fix the cause, then retry.',
      href: '/dashboard/meta-lead-inbox',
    },
    {
      slug: 'meta-mappings',
      title: 'Meta Page Mapping',
      description: 'Which branch each Meta Page (and optionally each lead form) routes inbound leads to.',
      href: '/dashboard/meta-mappings',
    },
    {
      slug: 'meta-campaigns',
      title: 'Meta Campaign Mapping',
      description: 'Confirm or correct which type each Meta campaign is, and preview the lead impact before committing.',
      href: '/dashboard/meta-campaigns',
    },
    {
      slug: 'lead-pull',
      title: 'Meta Lead Pull',
      description: 'Backfill leads the live webhook missed — review what is genuinely missing from LMS, then apply only that.',
      href: '/dashboard/lead-pull',
    },
    {
      slug: 'lead-assignment-rerun',
      title: 'Re-run Auto-Assignment',
      description: 'Assign leads that arrived unassigned — after fixing lead weights or a role’s department.',
      href: '/dashboard/lead-assignment-rerun',
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

// Stitch groups the cards into named sections. Anything not listed here lands in
// the module's last section, so a new table or screen can never go missing.
const SECTION_DEFS: Partial<Record<ModuleKey, { id: string; title: string; blurb?: string; slugs: string[] }[]>> = {
  platform: [
    {
      id: 'tenants',
      title: 'Tenant Management & Licensing',
      blurb: 'Top-level tenant partitions, subscription tiers and corporate structure.',
      slugs: ['tenants', 'tenant-plan-types', 'organizations'],
    },
    { id: 'lookups', title: 'Lookups & Taxonomy', blurb: 'Users, catalog versions and global reference keys.', slugs: [] },
  ],
  lms: [
    {
      id: 'meta',
      title: 'Meta Lead Pipeline & Integrations',
      blurb: 'Inbound automation.',
      slugs: ['meta-connection', 'meta-datasets', 'campaign-types', 'meta-ad-accounts', 'meta-lead-inbox', 'meta-mappings', 'meta-campaigns', 'lead-pull', 'capi-outbox'],
    },
    { id: 'ops', title: 'Operations & Allocation', blurb: 'Queue recalibration.', slugs: ['lead-assignment-rerun'] },
    { id: 'lookups', title: 'Pipeline Taxonomy & Lookups', blurb: 'Classification and signal dictionaries.', slugs: [] },
  ],
};

export default async function ModulePage({ params }: PageProps) {
  const { module } = await params;
  if (!isModuleKey(module)) notFound();

  const def = MODULES.find((m) => m.key === module)!;
  const tables = tablesByModule(module);
  const extraCards = EXTRA_CARDS[module] ?? [];
  const cardCount = tables.length + extraCards.length;

  const cards: ConsoleCard[] = [
    ...extraCards.map((c) => ({ key: c.slug, title: c.title, description: c.description, href: c.href })),
    ...tables.map((t) => ({ key: t.slug, title: t.title, description: t.description, href: `/dashboard/lookups/${t.slug}` })),
  ];

  const defs = SECTION_DEFS[module];
  let sections: ConsoleSection[];
  if (!defs) {
    sections = [{ id: 'all', title: '', cards }];
  } else {
    const claimed = new Set(defs.flatMap((d) => d.slugs));
    sections = defs
      .map((d, i) => ({
        id: d.id,
        title: d.title,
        blurb: d.blurb,
        cards:
          i === defs.length - 1
            ? cards.filter((c) => !claimed.has(c.key))
            : d.slugs.flatMap((slug) => cards.filter((c) => c.key === slug)),
      }))
      .filter((s) => s.cards.length > 0);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={def.label} subtitle={`${cardCount} table${cardCount === 1 ? '' : 's'}`} info={def.description} />
      <PageBody dense>
        {cardCount === 0 ? (
          <p className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant">
            Nothing configured in this module yet.
          </p>
        ) : (
          <ModuleConsole sections={sections} />
        )}
      </PageBody>
    </div>
  );
}
