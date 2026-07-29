import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getServerSession } from '@platform/ui-kit/server';
import { buildLoginUrl, usableProducts } from '@platform/ui-kit';
import SignOutButton from '@/components/auth/SignOutButton';
import { sessionDestination } from '@/src/lib/callback';

export const metadata: Metadata = {
  title: 'No product access · FitClass',
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

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F8FAFC] px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <div className="rounded-2xl bg-[#0b1f3a] px-6 py-4">
            <Image
              src="/fitclass-logo-white.webp"
              alt="FitClass"
              width={180}
              height={42}
              priority
              className="h-9 w-auto object-contain"
            />
          </div>
        </div>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            No products are assigned to your account
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#64748B]">
            You are signed in, but your account has no access to CRM, HR or Tasks.
            An administrator needs to grant it before you can continue.
          </p>

          <dl className="mt-5 space-y-2 rounded-lg bg-[#F8FAFC] p-4 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-[#64748B]">Signed in as</dt>
              <dd className="text-right font-semibold text-[#0F172A]">{session.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-[#64748B]">Branch</dt>
              <dd className="text-right font-semibold text-[#0F172A]">{session.org_name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-[#64748B]">Organisation</dt>
              <dd className="text-right font-semibold text-[#0F172A]">{session.tenant_name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-medium text-[#64748B]">Role</dt>
              <dd className="text-right font-semibold text-[#0F172A]">{session.role_label}</dd>
            </div>
          </dl>

          <div className="mt-6">
            <SignOutButton />
          </div>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-400">
          Quote the details above when contacting your administrator — they identify
          exactly which grant is missing.
        </p>
      </div>
    </div>
  );
}
