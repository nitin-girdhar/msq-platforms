import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from '@platform/ui-kit/server';
import { productOrigins } from '@platform/ui-kit';
import LoginForm from '@/components/auth/LoginForm';
import AuthFrame from '@/components/auth/AuthFrame';
import { resolveCallback, sessionDestination } from '@/src/lib/callback';
import { loadBrand } from '@/src/lib/brand';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string; t?: string }>;
}

export async function generateMetadata({ searchParams }: LoginPageProps): Promise<Metadata> {
  const { brand } = await loadBrand((await searchParams).t);
  const name = brand.brandName ?? 'FitClass';
  return {
    title: `Sign in · ${name}`,
    description: `Secure single sign-on for the ${name} platform`,
    ...(brand.assets.favicon ? { icons: { icon: brand.assets.favicon, apple: brand.assets.app_icon ?? '/icons/apple-touch-icon.png' } } : {}),
  };
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [result, params] = await Promise.all([getServerSession(), searchParams]);

  // Allowlist-validate the post-login target (open-redirect guard). Absolute
  // product URLs from a product app's middleware are honored; anything else is
  // rejected to null and the landing gets derived from the session instead.
  const callbackUrl = resolveCallback(params.callbackUrl);

  // Already signed in (cookie shared on .app.com): skip the form entirely —
  // this is what makes switching products a no-login hop. The session is in hand
  // here, so an absent callback resolves server-side.
  if (result) {
    redirect(callbackUrl ?? sessionDestination(result.licensedProducts, result.session));
  }

  // Not signed in yet, so there is no session to derive from. The form does it
  // from the login response, which needs the product origins — resolved here
  // because productOrigins() reads server-only env.
  const origins = productOrigins();

  // ?t=<public_key> (tenant login link) or the brand this device remembered:
  // display only — the tenant is still derived from the authenticated user.
  const { brandKey, brand } = await loadBrand(params.t);
  const name = brand.brandName ?? 'FitClass';

  return (
    <AuthFrame
      brand={brand}
      brandKey={brandKey}
      footer={
        <p className="text-center text-label-sm leading-relaxed text-outline lg:text-left">
          Access is restricted to authorised {name} accounts. By signing in you agree to {name} internal usage policies.
        </p>
      }
    >
      <header className="mb-8 text-center lg:text-left">
        <h2 className="text-headline-md font-bold tracking-tight text-on-surface">Welcome back</h2>
        <p className="mt-2 text-body-sm text-on-surface-variant">Sign in to access your {name} tools.</p>
      </header>
      <LoginForm callbackUrl={callbackUrl} productOrigins={origins} />
    </AuthFrame>
  );
}
