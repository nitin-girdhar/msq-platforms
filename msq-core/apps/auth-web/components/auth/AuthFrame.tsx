import type { ReactNode } from 'react';
import { ThemeStyle } from '@platform/ui-kit/theme';
import type { PublicBranding } from '@platform/ui-kit/branding';
import BrandPanel from './BrandPanel';
import MobileBrand from './MobileBrand';
import RememberBrand from './RememberBrand';

interface Props {
  brand: PublicBranding;
  brandKey: string | null;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Split sign-in frame (Stitch "Enterprise Login"): brand hero left on
 * desktop, the form card right. Pre-login pages have no session, so the root
 * layout rendered the platform theme; a branded link's theme is laid over it
 * here (a later, equally-specific :root block wins).
 */
export default function AuthFrame({ brand, brandKey, children, footer }: Props) {
  return (
    <>
      {brandKey && <ThemeStyle theme={brand.theme} />}
      <RememberBrand brandKey={brandKey} />
      <div className="grid h-full min-h-screen w-full overflow-y-auto bg-surface-container-lowest lg:grid-cols-2">
        <BrandPanel brand={brand} />
        <section className="flex flex-col items-center justify-center px-6 py-12 sm:px-12">
          <div className="w-full max-w-sm">
            <MobileBrand brand={brand} className="mb-10 lg:hidden" />
            {children}
          </div>
          {footer && <div className="mt-8 w-full max-w-sm">{footer}</div>}
        </section>
      </div>
    </>
  );
}
