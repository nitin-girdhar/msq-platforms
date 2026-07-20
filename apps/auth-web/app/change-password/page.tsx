import { redirect } from 'next/navigation';
import { getServerSession } from '@platform/ui-kit/server';
import { buildLoginUrl } from '@platform/ui-kit';
import ChangePasswordForm from '@/components/auth/ChangePasswordForm';
import { resolveCallback } from '@/src/lib/callback';

export const dynamic = 'force-dynamic';

interface ChangePasswordPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function ChangePasswordPage({ searchParams }: ChangePasswordPageProps) {
  const [result, params] = await Promise.all([getServerSession(), searchParams]);
  if (!result) redirect(buildLoginUrl());

  const destination = resolveCallback(params.callbackUrl);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F8FAFC] px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            {result.session.force_password_change ? 'Set a new password' : 'Change password'}
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            {result.session.force_password_change
              ? 'Your password was reset by an administrator. Choose a new one to continue.'
              : 'Update the password for your account.'}
          </p>
        </header>
        <ChangePasswordForm forced={result.session.force_password_change} destination={destination} />
      </div>
    </div>
  );
}
