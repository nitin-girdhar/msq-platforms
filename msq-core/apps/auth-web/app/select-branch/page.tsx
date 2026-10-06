import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DEFAULT_BRAND, getEffectiveBranding, getServerSession } from '@platform/ui-kit/server';
import { buildLoginUrl, InstallPrompt } from '@platform/ui-kit';
import AuthCard, { BranchIcon } from '@/components/auth/AuthCard';
import SelectBranchList from '@/components/auth/SelectBranchList';
import { resolveCallback, sessionDestination } from '@/src/lib/callback';

export const metadata: Metadata = {
  title: `Select branch · ${DEFAULT_BRAND.name}`,
  description: `Choose which ${DEFAULT_BRAND.name} branch to work in`,
};

export const dynamic = 'force-dynamic';

interface SelectBranchPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SelectBranchPage({ searchParams }: SelectBranchPageProps) {
  const [result, params] = await Promise.all([getServerSession(), searchParams]);

  const callbackUrl = resolveCallback(params.callbackUrl);
  if (!result) redirect(buildLoginUrl(callbackUrl ?? undefined));

  // Normally arrived at with an explicit callback forwarded from the login form.
  // Without one, derive from the session rather than assuming a product.
  const destination =
    callbackUrl ?? sessionDestination(result.licensedProducts, result.session);

  // Signed in: the session tenant's branding (the root layout already themed the
  // page with it); only the logo/name are needed for the card header.
  const b = await getEffectiveBranding();
  const brand = { theme: b.theme, brandName: b.brandName, productLabels: [], assets: b.assets };

  return (
    <AuthCard
      brand={brand}
      width="lg"
      icon={BranchIcon}
      title="Select your branch"
      subtitle="You have access to multiple branches. Choose one to continue — you can switch anytime from the top bar."
    >
      <div className="mb-4">
        <InstallPrompt />
      </div>
      <SelectBranchList callbackUrl={destination} />
    </AuthCard>
  );
}
