import type { ProductKey } from '@crm/types';

const PRODUCT_LABELS: Record<ProductKey, string> = {
  lms: 'CRM',
  hr: 'HR',
  task: 'Tasks',
};

// Landing path within each product origin. Stable product entry points.
const PRODUCT_LANDING: Record<ProductKey, string> = {
  lms: '/dashboard/leads',
  hr: '/attendance',
  task: '/tasks',
};

interface Props {
  licensedProducts: ProductKey[];
  // Absolute origin per product (from productOrigins()). A product with no
  // configured origin is skipped — we can't link to it.
  origins: Record<ProductKey, string>;
  // Which product THIS app is, so its chip renders active. Each product image
  // knows its own identity; no pathname sniffing across origins.
  activeProduct: ProductKey;
}

// Cross-origin product switcher. Unlike the pre-split version (same-app paths),
// each link points at the sibling product's own origin — the shared .app.com
// cookie means the hop lands authenticated with no re-login.
export default function ProductSwitcher({ licensedProducts, origins, activeProduct }: Props) {
  const products = licensedProducts.filter((p) => p === activeProduct || origins[p]);

  // Nothing to switch between when the tenant only has one (reachable) product.
  if (products.length <= 1) return null;

  return (
    <nav
      aria-label="Products"
      className="hidden items-center gap-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-1 sm:flex"
    >
      {products.map((p) => {
        const active = p === activeProduct;
        const href = active ? PRODUCT_LANDING[p] : `${origins[p]}${PRODUCT_LANDING[p]}`;
        return (
          <a
            key={p}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-md bg-white px-3 py-1 text-xs font-semibold text-[#0b6cbf] shadow-sm'
                : 'rounded-md px-3 py-1 text-xs font-medium text-[#475569] transition-colors hover:text-[#0F172A]'
            }
          >
            {PRODUCT_LABELS[p]}
          </a>
        );
      })}
    </nav>
  );
}
