import type { Metadata } from 'next';
import AuthCard, { KeyIcon } from '@/components/auth/AuthCard';
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm';
import { loadBrand } from '@/src/lib/brand';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Reset your password' };

interface Props {
  searchParams: Promise<{ t?: string }>;
}

// Pre-login, no session. Branded like /login (?t= or the remembered key).
export default async function ForgotPasswordPage({ searchParams }: Props) {
  const { brandKey, brand } = await loadBrand((await searchParams).t);
  return (
    <AuthCard
      brand={brand}
      brandKey={brandKey}
      icon={KeyIcon}
      title="Reset your password"
      subtitle="Enter the email you sign in with and we’ll send you a link to choose a new password."
      footer={
        <>
          <a href="/login" className="font-semibold text-primary hover:underline">← Back to sign in</a>
          <span className="text-on-surface-variant">Account locked? Contact your company admin.</span>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
