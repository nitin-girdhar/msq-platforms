import type { Metadata } from 'next';
import AuthCard, { LockIcon } from '@/components/auth/AuthCard';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';
import { loadBrand } from '@/src/lib/brand';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set a new password',
  // The token is in the URL: keep it out of the Referer of any outbound link.
  referrer: 'no-referrer',
};

interface Props {
  searchParams: Promise<{ token?: string; t?: string }>;
}

// Same shape as the server's check (32 random bytes, base64url). A malformed
// token is answered here without a round-trip; a well-formed one is only
// trusted by identity-service when it is spent.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export default async function ResetPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const { brandKey, brand } = await loadBrand(params.t);
  const token = typeof params.token === 'string' && TOKEN_RE.test(params.token) ? params.token : null;

  return (
    <AuthCard
      brand={brand}
      brandKey={brandKey}
      icon={LockIcon}
      title="Set a new password"
      subtitle={token ? 'Choose a new password for your account.' : undefined}
      footer={<a href="/login" className="font-semibold text-primary hover:underline">← Back to sign in</a>}
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="flex flex-col gap-4 text-center">
          <p className="text-body-md text-on-surface-variant">This reset link is invalid or has expired.</p>
          <a
            href="/forgot-password"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-3 text-label-md font-semibold text-on-primary hover:opacity-90"
          >
            Request a new link
          </a>
        </div>
      )}
    </AuthCard>
  );
}
