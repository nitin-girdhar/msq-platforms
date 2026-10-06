import { redirect } from 'next/navigation';
import { getEffectiveBranding, getServerSession } from '@platform/ui-kit/server';
import { buildLoginUrl } from '@platform/ui-kit';
import AuthCard, { LockIcon } from '@/components/auth/AuthCard';
import ChangePasswordForm from '@/components/auth/ChangePasswordForm';
import { resolveCallback, sessionDestination } from '@/src/lib/callback';

export const dynamic = 'force-dynamic';

interface ChangePasswordPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function ChangePasswordPage({ searchParams }: ChangePasswordPageProps) {
  const [result, params] = await Promise.all([getServerSession(), searchParams]);
  if (!result) redirect(buildLoginUrl());

  // The session is already in hand here, so an absent/rejected callback resolves
  // to a product this user can actually open rather than a hardcoded default.
  const destination =
    resolveCallback(params.callbackUrl) ??
    sessionDestination(result.licensedProducts, result.session);

  // Signed in: the session tenant's branding (the root layout already themed
  // the page with it). Only the logo/name are needed for the card header.
  const b = await getEffectiveBranding();
  const brand = { theme: b.theme, brandName: b.brandName, productLabels: [], assets: b.assets };
  const forced = result.session.force_password_change;

  return (
    <AuthCard
      brand={brand}
      icon={LockIcon}
      title={forced ? 'Set a new password' : 'Change password'}
      subtitle={
        forced
          ? 'Your password was reset by an administrator. Choose a new one to continue.'
          : 'Update the password for your account.'
      }
    >
      <ChangePasswordForm forced={forced} destination={destination} />
    </AuthCard>
  );
}
