import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { DEFAULT_BRAND, getServerSession } from '@platform/ui-kit/server';
import { buildLoginUrl, usableProducts } from '@platform/ui-kit';
import AuthCard, { ShieldAlertIcon } from '@/components/auth/AuthCard';
import SignOutButton from '@/components/auth/SignOutButton';
import { sessionDestination } from '@/src/lib/callback';

export const metadata: Metadata = {
  title: `No product access · ${DEFAULT_BRAND.name}`,
  description: 'This account has no products assigned',
};

export const dynamic = 'force-dynamic';

// Terminal screen for an authenticated user whose tenant license and personal
// capabilities intersect to nothing. Reached from the login flow and from a
// product app's denial redirect.
//
// It exists so that state is READABLE. Without it the user bounces between
// product origins that each 403 them, or lands on a rendered shell with an empty
// sidebar — indistinguishable from the app being broken. Showing the org and
// tenant makes it something support can act on in one message.
export default async function NoAccessPage() {
  const result = await getServerSession();
  if (!result) redirect(buildLoginUrl());

  // Entitlements may have been granted since they were sent here. Don't strand
  // someone on a dead end that no longer applies.
  if (usableProducts(result.licensedProducts, result.session).length > 0) {
    redirect(sessionDestination(result.licensedProducts, result.session));
  }

  const { session } = result;
  const rows: Array<[string, string]> = [
    ['Signed in as', session.email],
    ['Branch', session.org_name],
    ['Organisation', session.tenant_name],
    ['Role', session.role_label],
  ];

  return (
    <AuthCard
      icon={ShieldAlertIcon}
      iconTone="error"
      title="No products are assigned to your account"
      subtitle="You are signed in, but your account has no access to CRM, HR or Tasks. An administrator needs to grant it before you can continue."
      topSlot={
        <div className="rounded-2xl bg-inverse-surface px-6 py-4">
          {/* Emblem, not the full lockup: the square white lockup (emblem + wordmark
              + tagline) collapses to an illegible smudge when squeezed to h-9 — see
              auth-web/app/login/page.tsx. */}
          <Image
            src={DEFAULT_BRAND.emblem}
            alt={DEFAULT_BRAND.name}
            width={160}
            height={160}
            priority
            className="h-9 w-auto object-contain"
          />
        </div>
      }
      footer={
        <p className="w-full text-center text-label-md text-on-surface-variant">
          Quote the details above when contacting your administrator — they identify exactly which grant is missing.
        </p>
      }
    >
      <dl className="space-y-2 rounded-lg bg-surface-container-low p-4 text-label-md">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="font-medium text-on-surface-variant">{label}</dt>
            <dd className="min-w-0 break-words text-right font-semibold text-on-surface">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-col gap-3">
        {/* Another branch may carry the grant this one lacks. /select-branch is the
            existing picker; it needs a session and a single-branch user is sent
            straight back, so this adds no new action. */}
        <a
          href="/select-branch"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-label-md font-semibold text-on-primary shadow-card transition-opacity hover:opacity-90"
        >
          Switch branch
        </a>
        <SignOutButton loginUrl={buildLoginUrl()} variant="subtle" />
      </div>
    </AuthCard>
  );
}
