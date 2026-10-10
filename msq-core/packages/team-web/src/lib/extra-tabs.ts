import type { ReactNode } from 'react';

// Extra tabs a HOST adds to the Team edit drawer, beside the built-in Account tab. This is how
// product-owned facts (the HR profile today) are edited in the one place people already manage a
// member, without team-web importing a product package: the host (admin-web) supplies the tabs and
// decides, from the actor's capabilities, whether to supply any at all.
export interface TeamExtraTabContext {
  /** The member being edited. */
  userId: string;
  name: string;
  /** The member is the signed-in actor (their own record). */
  isSelf: boolean;
}

export interface TeamExtraTab {
  /** Stable key; never shown. */
  id: string;
  label: string;
  /** Rendered lazily, the first time the tab is opened, then kept mounted so unsaved edits survive tab switches. */
  render: (ctx: TeamExtraTabContext) => ReactNode;
}
