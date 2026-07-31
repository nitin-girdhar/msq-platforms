// ── The capability tree walk, in TypeScript (Tier C3) ───────────────────────
//
// A faithful mirror of iam.fn_role_capability_matrix (db_scripts/02_schema.sql
// lines 3072-3109). The SQL is AUTHORITATIVE — every gate in every service and
// the /auth/me capability list resolve through it. This file exists for the one
// job the SQL cannot do: telling an ADMIN UI not just whether a node is on, but
// WHY, so an operator can see the difference between "granted by a row" and
// "on because its parent is on and it has no row of its own".
//
// That distinction is the whole point. Before this existed, the Capability
// Matrix screen rendered a rowless page as UNCHECKED while the resolver said
// GRANTED, so hiding a page looked like a no-op and unticking it actually
// turned it on. See CapabilityMatrixClient.tsx.
//
// If the SQL walk ever changes, change this too — resolveCapabilityMatrix()'s
// branches are commented with the SQL lines they mirror, and matrix.test.ts
// pins the behaviour that matters.

/** Mirrors the iam.capability_kind enum. The tree nests tool -> page -> tab ->
 *  operation -> scope, but only `kind` decides how a missing grant resolves. */
export type CapabilityKind = 'tool' | 'page' | 'tab' | 'operation' | 'scope';

/** The subset of an iam.capabilities row the walk needs. Snake_case because
 *  this is the shape GET /capabilities hands back, unchanged. */
export interface CapabilityNode {
  id: string;
  key: string;
  kind: CapabilityKind;
  parent_key: string | null;
}

/** One iam.role_capabilities row as the API returns it, for one role. */
export interface RoleCapabilityGrant {
  capability_id: string;
  tenant_id: string | null;
  is_granted: boolean;
}

/**
 * WHY a node resolved the way it did.
 *
 * "Off" has four different meanings and only one of them is fixed by ticking a
 * box, so the UI has to be able to tell them apart:
 *   - explicit-deny    the role has a row here saying FALSE — untick to remove
 *   - inherited-deny   no row, and the nearest nav ancestor is off
 *   - no-grant         no row on a tool/operation/scope — these never inherit
 *   - ancestor-denied  an ancestor is off, so this subtree is pruned entirely;
 *                      granting here changes nothing until the ancestor is fixed
 */
export type GrantSource =
  | 'explicit-grant'
  | 'explicit-deny'
  | 'inherited-grant'
  | 'inherited-deny'
  | 'no-grant'
  | 'ancestor-denied';

export interface ResolvedCapability {
  key: string;
  kind: CapabilityKind;
  parentKey: string | null;
  /**
   * Depth along the parent_key chain — NOT the number of dots in the key. The
   * two disagree wherever a key carries dots below its own parent:
   * `lms.leads.interaction.log` is a direct child of `lms.leads`, so depth 2,
   * while the dot count says 3.
   */
  depth: number;
  granted: boolean;
  source: GrantSource;
  /** This role's own row at this node: true, false, or null for "no row". */
  ownGrant: boolean | null;
  /** For 'ancestor-denied', the nearest ancestor that pruned it. */
  deniedBy: string | null;
}

/**
 * Collapse the two grant layers into one answer per capability key.
 *
 * Mirrors the grant_resolved CTE (02_schema.sql:3075-3081): a row scoped to the
 * acting tenant beats the platform default (tenant_id IS NULL); rows belonging
 * to some OTHER tenant are not this tenant's business and are ignored.
 */
export function ownGrantsByKey(
  nodes: readonly CapabilityNode[],
  rows: readonly RoleCapabilityGrant[],
  tenantId: string,
): Map<string, boolean> {
  const keyById = new Map(nodes.map((n) => [n.id, n.key]));
  const defaults = new Map<string, boolean>();
  const overrides = new Map<string, boolean>();

  for (const row of rows) {
    const key = keyById.get(row.capability_id);
    if (key === undefined) continue;
    if (row.tenant_id === null) defaults.set(key, row.is_granted);
    else if (row.tenant_id === tenantId) overrides.set(key, row.is_granted);
  }

  return new Map([...defaults, ...overrides]);
}

interface WalkState extends ResolvedCapability {
  /**
   * The value a page/tab child inherits when it has no row of its own.
   *
   * Tracked SEPARATELY from `granted` because the SQL does (02_schema.sql:3101-
   * 3103): the nav_inherited CASE has no `WHEN NOT w.granted` arm, so it keeps
   * flowing down even through a pruned subtree. Collapsing the two into one
   * field is the easiest way to diverge from the database.
   */
  navInherited: boolean;
}

const INHERITS: ReadonlySet<CapabilityKind> = new Set<CapabilityKind>(['page', 'tab']);

/**
 * Resolve every capability the tree can reach, for one role.
 *
 * Roots are the tools, and a tool is on only if a row says so (02_schema.sql:
 * 3083-3091) — there is nothing above it to inherit from. Below that, nav nodes
 * (page/tab) fall back to their parent while operations and scopes always need
 * their own row. A node whose parent is off is FALSE regardless of its own row.
 *
 * Nodes unreachable from any root — an orphan whose parent_key names something
 * absent or inactive — are OMITTED from the result, exactly as the recursive
 * CTE omits them. They cannot be granted at all, and saying `false` would imply
 * ticking the box could change that.
 */
export function resolveCapabilityMatrix(
  nodes: readonly CapabilityNode[],
  ownGrants: ReadonlyMap<string, boolean>,
): Map<string, ResolvedCapability> {
  const childrenOf = new Map<string | null, CapabilityNode[]>();
  for (const node of nodes) {
    const siblings = childrenOf.get(node.parent_key);
    if (siblings) siblings.push(node);
    else childrenOf.set(node.parent_key, [node]);
  }

  const resolved = new Map<string, WalkState>();

  const visit = (node: CapabilityNode, parent: WalkState | null): void => {
    const own = ownGrants.get(node.key) ?? null;
    const inherits = INHERITS.has(node.kind);

    let granted: boolean;
    let navInherited: boolean;
    let source: GrantSource;
    let deniedBy: string | null = null;

    if (!parent) {
      // Root/tool arm — 02_schema.sql:3084-3086.
      granted = own ?? false;
      navInherited = granted;
      source = own === true ? 'explicit-grant' : own === false ? 'explicit-deny' : 'no-grant';
    } else {
      // Recursive arm — 02_schema.sql:3095-3103.
      navInherited = inherits ? (own ?? parent.navInherited) : parent.navInherited;
      granted = !parent.granted ? false : inherits ? (own ?? parent.navInherited) : (own ?? false);

      if (!parent.granted) {
        source = 'ancestor-denied';
        // The NEAREST ancestor that actually resolved false: the parent itself
        // when the parent is where it went wrong, otherwise whatever pruned the
        // parent. Naming the parent every time would send an operator to fix a
        // node that is only a victim too.
        deniedBy = parent.deniedBy ?? parent.key;
      } else if (own === true) {
        source = 'explicit-grant';
      } else if (own === false) {
        source = 'explicit-deny';
      } else if (inherits) {
        source = parent.navInherited ? 'inherited-grant' : 'inherited-deny';
      } else {
        source = 'no-grant';
      }
    }

    const state: WalkState = {
      key: node.key,
      kind: node.kind,
      parentKey: node.parent_key,
      depth: parent ? parent.depth + 1 : 0,
      granted,
      source,
      ownGrant: own,
      deniedBy,
      navInherited,
    };
    resolved.set(node.key, state);

    for (const child of childrenOf.get(node.key) ?? []) visit(child, state);
  };

  for (const root of childrenOf.get(null) ?? []) visit(root, null);

  // Drop navInherited on the way out — it is walk bookkeeping, not an answer.
  return new Map(
    [...resolved].map(([key, { navInherited: _navInherited, ...rest }]) => [key, rest]),
  );
}
