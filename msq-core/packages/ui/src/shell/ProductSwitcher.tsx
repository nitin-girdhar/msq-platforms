import type { ProductKey } from "@platform/types";
import type { CapabilityHolder } from "@platform/rbac";
import { PRODUCT_LANDING, usableProducts } from "./products";

const PRODUCT_LABELS: Record<ProductKey, string> = {
  lms: "LMS",
  hr: "HRMS",
  task: "Tasks",
};

interface ExtraLink {
  key: string;
  href: string;
  label: string;
  // Renders this pill with the same "current page" treatment as an active
  // product chip. For the Admin link shown on LMS/HR/Task, this is always
  // false (Admin is never the app you're standing in there). admin-web's own
  // header passes true for its own Admin pill instead — same current-page
  // affordance, since activeProduct can't express it (Admin isn't a product).
  active?: boolean;
}

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
  // knows its own identity; no pathname sniffing across origins. Omitted from
  // non-product shells (e.g. admin-web) that render the switcher purely to
  // link back out — no chip is "current" there, so every product link is
  // cross-origin.
  activeProduct?: ProductKey;
  // Non-product links (e.g. the rank-gated "Admin" link) rendered as trailing
  // pills in this same unified group, purely for visual consistency. They are
  // NOT products: they never factor into usableProducts/PRODUCT_LANDING, so
  // admin-web still can't be chosen as a landing target or compete for the
  // active chip.
  extraLinks?: ExtraLink[];
}

// Cross-origin product switcher. Unlike the pre-split version (same-app paths),
// each link points at the sibling product's own origin — the shared .app.com
// cookie means the hop lands authenticated with no re-login.
export default function ProductSwitcher({
  licensedProducts,
  actor,
  origins,
  activeProduct,
  extraLinks = [],
}: Props) {
  // The origin exemption covers the ACTIVE product only: we're already here, so
  // a missing origin can't break the link. Capability is deliberately not
  // exempted — a product the user cannot use is not papered over by being the
  // one they happen to be looking at.
  const products = usableProducts(licensedProducts, actor).filter(
    (p) => p === activeProduct || origins[p],
  );

  // Nothing to switch between when the tenant only has one (reachable)
  // product and there are no extra links (e.g. Admin) to show either.
  if (products.length <= 1 && extraLinks.length === 0) return null;

  // Capped at 5 columns — the widest we expect PRODUCT_LABELS + Admin to grow
  // to. Fewer items still get one column each (no empty cells) via the inline
  // template, and the grid collapses to an inline row once sm: kicks in.
  const columns = Math.min(products.length + extraLinks.length, 5);

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
        {extraLinks.map((link) => (
          <a
            key={link.key}
            href={link.href}
            aria-current={link.active ? "page" : undefined}
            className={
              link.active
                ? "rounded-md bg-white px-2 py-1.5 text-center text-xs font-semibold text-[#0b6cbf] shadow-sm sm:px-3 sm:py-1"
                : "rounded-md px-2 py-1.5 text-center text-xs font-medium text-[#475569] transition-colors hover:text-[#0F172A] sm:px-3 sm:py-1"
            }
          >
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
