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
  /** Card max width: 'md' (default, forms) or 'lg' (lists such as the branch picker). */
  width?: 'md' | 'lg';
  /** Static brand mark above the card for pages with no branding data (offline, no-access). */
  topSlot?: ReactNode;
  /** 'error' tints the header icon for a denial screen (no-access). */
  iconTone?: 'brand' | 'error';
}

/**
 * Centred single-card frame (Stitch "Forgot password" / "Change password"):
 * brand header, icon, title + subtitle, the form, and a footer row of links.
 */
export default function AuthCard({ title, subtitle, brand, brandKey = null, icon, children, footer, width = 'md', topSlot, iconTone = 'brand' }: Props) {
  return (
    <>
      {brand && brandKey && <ThemeStyle theme={brand.theme} />}
      {brand && <RememberBrand brandKey={brandKey} />}
      <div className="flex min-h-screen w-full items-start justify-center bg-surface px-4 py-10 sm:items-center sm:py-12">
        <div className={`w-full ${width === 'lg' ? 'max-w-lg' : 'max-w-md'}`}>
          {brand && <MobileBrand brand={brand} className="mb-6" />}
          {!brand && topSlot && <div className="mb-6 flex justify-center">{topSlot}</div>}
          <div className="rounded-xl bg-surface-container-lowest p-6 shadow-card sm:p-8">
            <header className="mb-6 flex flex-col items-center text-center">
              {icon && (
                <span className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl ${iconTone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-primary-fixed text-primary'}`} aria-hidden>
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

export const BranchIcon = (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
  </svg>
);

export const WifiOffIcon = (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-8.3-3.7M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.8-1.9M2 2l20 20" />
  </svg>
);

export const ShieldAlertIcon = (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="M12 8v4M12 16h.01" />
  </svg>
);

export const LockIcon = (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
