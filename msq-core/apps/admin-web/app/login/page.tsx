import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from '@platform/ui-kit/server';
import { adminWebOrigin } from '@platform/ui-kit';
import LoginForm from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in · Admin',
  description: 'Sign in to the org/tenant admin console',
};

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

async function isAuthenticated(): Promise<boolean> {
  return (await getServerSession()) !== null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [authed, params] = await Promise.all([
    isAuthenticated(),
    searchParams,
  ]);

  const callbackPath =
    params.callbackUrl && params.callbackUrl.startsWith('/')
      ? params.callbackUrl
      : '/dashboard';

  // For auth-web's callback validation, we need an absolute URL, not a relative path.
  // Build the full admin-web URL that auth-web will redirect back to after login.
  const adminOrigin = adminWebOrigin();
  const absoluteCallback = adminOrigin
    ? `${adminOrigin}${callbackPath}`
    : callbackPath;

  if (authed) redirect(callbackPath);

  return (
    <div className="grid h-full w-full overflow-y-auto bg-surface-container-lowest lg:grid-cols-2">
      {/* Brand panel — left on desktop, hidden on mobile */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-inverse-surface p-12 lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary opacity-30 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-primary opacity-20 blur-3xl"
          aria-hidden
        />

        <div className="relative">
          <span className="text-lg font-bold tracking-tight text-on-primary">Admin</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight text-on-primary">
            Team, API tokens, and HR admin — one console for org and tenant admins.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-outline">
            Manage your team, issue API tokens, and configure leave and
            attendance policies for your organization.
          </p>
        </div>

        <p className="relative text-xs text-outline">
          © {new Date().getFullYear()} CRM · Admin
        </p>
      </aside>

      {/* Auth panel */}
      <section className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex justify-center lg:hidden">
            <div className="rounded-2xl bg-inverse-surface px-6 py-4">
              <span className="text-base font-bold tracking-tight text-on-primary">Admin</span>
            </div>
          </div>

          <header className="mb-8 text-center lg:text-left">
            <h2 className="text-2xl font-bold tracking-tight text-on-surface">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-on-surface-variant">
              Sign in to manage your organization.
            </p>
          </header>

          <LoginForm callbackUrl={absoluteCallback} />

          <p className="mt-8 text-center text-xs leading-relaxed text-outline lg:text-left">
            Access is restricted to org and tenant admin accounts. By signing in
            you agree to internal usage policies.
          </p>
        </div>
      </section>
    </div>
  );
}
