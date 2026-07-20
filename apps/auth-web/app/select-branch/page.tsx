import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getServerSession } from '@platform/ui-kit/server';
import { buildLoginUrl } from '@platform/ui-kit';
import SelectBranchList from '@/components/auth/SelectBranchList';
import { resolveCallback } from '@/src/lib/callback';

export const metadata: Metadata = {
  title: 'Select branch · FitClass',
  description: 'Choose which FitClass branch to work in',
};

export const dynamic = 'force-dynamic';

interface SelectBranchPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SelectBranchPage({ searchParams }: SelectBranchPageProps) {
  const [result, params] = await Promise.all([getServerSession(), searchParams]);

  const destination = resolveCallback(params.callbackUrl);
  if (!result) redirect(buildLoginUrl(destination));

  return (
    <div className="flex min-h-screen w-full items-center justify-center overflow-y-auto bg-[#F8FAFC] px-6 py-12">
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

        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Select your branch</h1>
          <p className="mt-2 text-sm text-slate-500">
            You have access to multiple branches. Choose one to continue — you can
            switch anytime from the top bar.
          </p>
        </header>

        <SelectBranchList callbackUrl={destination} />
      </div>
    </div>
  );
}
