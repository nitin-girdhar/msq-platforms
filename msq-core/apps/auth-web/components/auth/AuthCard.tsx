import type { ReactNode } from 'react';
import { ThemeStyle } from '@platform/ui-kit/theme';
import type { PublicBranding } from '@platform/ui-kit/branding';
import MobileBrand from './MobileBrand';
import RememberBrand from './RememberBrand';

interface Props {
  title: string;
  subtitle?: ReactNode;
  /** A pre-login page's brand (forgot / reset). Omit on session pages. */
  brand?: PublicBranding;
  brandKey?: string | null;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Centred single-card frame (Stitch "Forgot password" / "Change password"):
 * brand header, icon, title + subtitle, the form, and a footer row of links.
 */
export default function AuthCard({ title, subtitle, brand, brandKey = null, icon, children, footer }: Props) {
  return (
    <>
      {brand && brandKey && <ThemeStyle theme={brand.theme} />}
      {brand && <RememberBrand brandKey={brandKey} />}
      <div className="flex min-h-screen w-full items-start justify-center bg-surface px-4 py-10 sm:items-center sm:py-12">
        <div className="w-full max-w-md">
          {brand && <MobileBrand brand={brand} className="mb-6" />}
          <div className="rounded-xl bg-surface-container-lowest p-6 shadow-card sm:p-8">
            <header className="mb-6 flex flex-col items-center text-center">
              {icon && (
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed text-primary" aria-hidden>
                  {icon}
                </span>
              )}
              <h1 className="text-headline-md font-bold tracking-tight text-on-surface">{title}</h1>
              {subtitle && <p className="mt-2 text-body-sm text-on-surface-variant">{subtitle}</p>}
            </header>
            {children}
          </div>
          {footer && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 px-1 text-label-md">{footer}</div>}
        </div>
      </div>
    </>
  );
}

export const KeyIcon = (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  </svg>
);

export const LockIcon = (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
