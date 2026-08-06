import type { ProductKey } from "@platform/types";
import type { CapabilityHolder } from "@platform/rbac";
import { PRODUCT_LANDING, usableProducts } from "./products";

const PRODUCT_LABELS: Record<ProductKey, string> = {
  lms: "LMS",
  hr: "HRMS",
  task: "Tasks",
};

interface Props {
  // What the TENANT has licensed. Necessary but not sufficient — see `actor`.
  licensedProducts: ProductKey[];
  // The acting user, for the capability half of the decision. Without it an
  // HR-only user in an LMS+HR tenant would still get an LMS chip leading to an
  // empty, 403-ing screen.
  actor: CapabilityHolder;
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
export default function ProductSwitcher({
  licensedProducts,
  actor,
  origins,
  activeProduct,
}: Props) {
  // The origin exemption covers the ACTIVE product only: we're already here, so
  // a missing origin can't break the link. Capability is deliberately not
  // exempted — a product the user cannot use is not papered over by being the
  // one they happen to be looking at.
  const products = usableProducts(licensedProducts, actor).filter(
    (p) => p === activeProduct || origins[p],
  );

  // Nothing to switch between when the tenant only has one (reachable) product.
  if (products.length <= 1) return null;

  // Capped at 4 columns — the widest we expect PRODUCT_LABELS to grow to.
  // Fewer products still get one column each (no empty cells) via the inline
  // template, and the grid collapses to an inline row once sm: kicks in.
  const columns = Math.min(products.length, 4);

  return (
    <nav aria-label="Products" className="w-full sm:w-auto">
      <div
        className="grid gap-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-1 sm:inline-flex sm:items-center"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {products.map((p) => {
          const active = p === activeProduct;
          const href = active
            ? PRODUCT_LANDING[p]
            : `${origins[p]}${PRODUCT_LANDING[p]}`;
          return (
            <a
              key={p}
              href={href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-md bg-white px-2 py-1.5 text-center text-xs font-semibold text-[#0b6cbf] shadow-sm sm:px-3 sm:py-1"
                  : "rounded-md px-2 py-1.5 text-center text-xs font-medium text-[#475569] transition-colors hover:text-[#0F172A] sm:px-3 sm:py-1"
              }
            >
              {PRODUCT_LABELS[p]}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
