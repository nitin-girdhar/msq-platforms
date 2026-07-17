import type { Metadata } from 'next';
import Image from 'next/image';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { jwtVerify } from 'jose';
import { AUTH_COOKIE_NAME, JWT_ISSUER, JWT_AUDIENCE } from '@crm/auth-constants';
import SelectBranchList from '@/components/auth/SelectBranchList';

export const metadata: Metadata = {
  title: 'Select branch · FitClass CRM',
  description: 'Choose which FitClass branch to work in',
};

export const dynamic = 'force-dynamic';

interface SelectBranchPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

async function isAuthenticated(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!token) return false;
    const secret = new TextEncoder().encode(process.env['JWT_SECRET']);
    await jwtVerify(token, secret, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    return true;
  } catch {
    return false;
  }
}

export default async function SelectBranchPage({ searchParams }: SelectBranchPageProps) {
  const [authed, params] = await Promise.all([isAuthenticated(), searchParams]);

  const safeCallback =
    params.callbackUrl && params.callbackUrl.startsWith('/')
      ? params.callbackUrl
      : '/dashboard/leads';

  if (!authed) redirect(`/login?callbackUrl=${encodeURIComponent(safeCallback)}`);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-[#F8FAFC] px-6 py-12">
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

        <SelectBranchList callbackUrl={safeCallback} />
      </div>
    </div>
  );
}
