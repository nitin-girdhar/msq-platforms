import Image from 'next/image';
import type { PublicBranding } from '@platform/ui-kit/branding';

const DEFAULT_PRODUCTS = ['LMS', 'HRMS', 'Tasks', 'Admin Console'];

/**
 * Left hero of the sign-in pages (desktop). Brand logo, name and product chips
 * come from the login link's public branding (?t=<public_key>) or the brand
 * this device remembered; otherwise the platform default. Display only.
 */
export default function BrandPanel({ brand }: { brand: PublicBranding }) {
  const name = brand.brandName ?? 'FitClass';
  const logo = brand.assets.logo_dark ?? brand.assets.mark;
  const products = brand.productLabels.length ? brand.productLabels : DEFAULT_PRODUCTS;
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-inverse-surface p-12 text-inverse-on-surface lg:flex">
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary opacity-30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-primary-container opacity-20 blur-3xl" aria-hidden />

      <div className="relative flex items-center gap-3">
        {logo ? (
          // Tenant asset served by the gateway (/api/public/branding/...): a plain
          // <img> — the optimizer would try to fetch it from this app.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={name} className="h-11 max-w-[200px] object-contain" />
        ) : (
          <Image src="/fitclass-emblem.png" alt="" width={160} height={160} priority className="h-11 w-11 object-contain" />
        )}
        {!brand.assets.logo_dark && <span className="text-headline-sm font-bold">{name}</span>}
      </div>

      <div className="relative max-w-md">
        <h1 className="text-display font-bold leading-tight">One sign-in for every {name} product.</h1>
        <p className="mt-4 text-body-md leading-relaxed text-inverse-on-surface/75">
          Leads, HR, and tasks — one account, one session. Sign in once and move between tools without logging in again.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {products.map((p) => (
            <li key={p} className="rounded-md bg-inverse-on-surface/10 px-3 py-1.5 text-label-md font-semibold">
              {p}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-label-sm text-inverse-on-surface/60">
        © {new Date().getFullYear()} {name} · Internal platform
      </p>
    </aside>
  );
}
