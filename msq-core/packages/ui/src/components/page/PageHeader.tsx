import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  /** Which slice of data the screen is acting on — rendered as a chip beside the
   *  title. Its one job is to make an out-of-band scope change VISIBLE where the
   *  data is: a super admin's tenant is set by the navbar switcher and silently
   *  reset to their home tenant on every login, so a screen that never names its
   *  tenant reads as if an edit had been lost. Keep it short (a tenant name, or
   *  `tenant · branch`); `subtitle` stays free for what the screen is about.
   *
   *  Explicitly `| undefined` (not bare optional) because `exactOptionalPropertyTypes`
   *  is on: callers resolve the scope from a session that may not have one and
   *  pass the result straight through, rather than spreading a conditional prop. */
  scope?: string | undefined;
  /** Tab strip (PageTabs) — rendered as the band's first row, full-bleed. */
  tabs?: ReactNode;
  /** Primary/secondary actions, right-aligned on the title row. */
  actions?: ReactNode;
}

// The chrome band that opens every product page. Mirrors the LMS dashboard's
// structure: full-bleed white bands separated by a single edge-to-edge rule,
// with the page gutter (`px-4 sm:px-5`) applied to the band's *content* only.
// Nesting the tab strip inside a padded page container — which HR and Tasks
// used to do — leaves its border-b floating short of both the sidebar rule and
// the right edge, which is the single biggest reason those pages read as
// unfinished next to LMS.
export default function PageHeader({ title, subtitle, scope, tabs, actions }: Props) {
  return (
    <header className="shrink-0 border-b border-outline-variant bg-surface-container-lowest">
      {tabs && <div className="px-4 sm:px-5">{tabs}</div>}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          {/* The title shrinks before the scope chip does: a truncated title is
              still recognisable from its first words, while a truncated tenant
              name is exactly the thing the chip exists to disambiguate. */}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate text-base font-bold tracking-tight text-on-surface">{title}</h1>
            {scope && (
              <span
                title={scope}
                className="max-w-[8rem] shrink-0 truncate rounded bg-surface-container px-1.5 py-0.5 text-[0.625rem] font-semibold text-on-surface-variant sm:max-w-[14rem]"
              >
                {scope}
              </span>
            )}
          </div>
          {subtitle && <p className="mt-0.5 truncate text-xs text-on-surface-variant">{subtitle}</p>}
        </div>
        {/* Wraps instead of shrink-0: a row of buttons wider than a phone used to push the page sideways. */}
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
