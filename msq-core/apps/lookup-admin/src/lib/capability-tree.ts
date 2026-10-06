import type { ResolvedCapability } from '@platform/rbac';
import type { CapabilityRow } from '@/src/lib/api/client';

// Tree helpers for the Capability Matrix. GET /capabilities returns a FLAT list;
// the hierarchy (tool -> page -> tab -> operation -> scope) lives only in
// parent_key, so every view of it is assembled here. Depth always follows
// parent_key — never the dot count of a key (see matrix.ts).

export type ChildIndex = Map<string | null, CapabilityRow[]>;

/** Children grouped by parent_key, siblings ordered by sort_order then key. */
export function buildIndex(rows: readonly CapabilityRow[]): ChildIndex {
  const index: ChildIndex = new Map();
  for (const row of rows) {
    const siblings = index.get(row.parent_key);
    if (siblings) siblings.push(row);
    else index.set(row.parent_key, [row]);
  }
  for (const siblings of index.values()) {
    siblings.sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  }
  return index;
}

/** Every node beneath `key`, depth-first. */
export function descendantsOf(index: ChildIndex, key: string): CapabilityRow[] {
  const out: CapabilityRow[] = [];
  const walk = (parent: string) => {
    for (const child of index.get(parent) ?? []) {
      out.push(child);
      walk(child.key);
    }
  };
  walk(key);
  return out;
}

/**
 * A column-2 entry. Most tools hold pages; some (Attendance, Leave) hold their
 * operations directly, which the design has no row for — those are grouped under
 * one synthetic "Direct operations" module so nothing is unreachable.
 */
export interface ModuleEntry {
  key: string;
  label: string;
  direct: boolean;
}

export function modulesOf(index: ChildIndex, toolKey: string): ModuleEntry[] {
  const kids = index.get(toolKey) ?? [];
  const modules: ModuleEntry[] = kids
    .filter((k) => k.kind === 'page' || k.kind === 'tab')
    .map((k) => ({ key: k.key, label: k.label, direct: false }));
  if (kids.some((k) => k.kind === 'operation' || k.kind === 'scope')) {
    modules.push({ key: toolKey, label: 'Direct operations', direct: true });
  }
  return modules;
}

/** Column-3 rows for one module, in tree order. */
export function rowsOfModule(index: ChildIndex, toolKey: string, module: ModuleEntry): CapabilityRow[] {
  if (!module.direct) return descendantsOf(index, module.key);
  const out: CapabilityRow[] = [];
  for (const child of index.get(toolKey) ?? []) {
    if (child.kind === 'page' || child.kind === 'tab') continue;
    out.push(child, ...descendantsOf(index, child.key));
  }
  return out;
}

/** Operations and scopes beneath a node — what the design counts as "perms". */
export function permsUnder(index: ChildIndex, key: string): CapabilityRow[] {
  return descendantsOf(index, key).filter((c) => c.kind === 'operation' || c.kind === 'scope');
}

export type Tone = 'granted' | 'inherited' | 'denied' | 'blocked' | 'off';

// Status colours are the fixed tokens (never brandable), so "denied" reads the
// same for every tenant.
export const TONE_CLASS: Record<Tone, string> = {
  granted: 'bg-status-success-container text-on-status-success-container',
  inherited: 'bg-status-info-container text-on-status-info-container',
  denied: 'bg-error-container text-on-error-container',
  blocked: 'bg-status-due-container text-on-status-due-container',
  off: 'bg-surface-container text-on-surface-variant',
};

export interface StateView {
  label: string;
  tone: Tone;
}

export function stateView(node: ResolvedCapability | undefined): StateView {
  if (!node) return { label: 'Unavailable', tone: 'off' };
  switch (node.source) {
    case 'explicit-grant': return { label: 'Granted', tone: 'granted' };
    case 'inherited-grant': return { label: 'Inherited', tone: 'inherited' };
    case 'explicit-deny': return { label: 'Denied', tone: 'denied' };
    case 'ancestor-denied': return { label: 'Blocked', tone: 'blocked' };
    case 'inherited-deny': return { label: 'Off', tone: 'off' };
    default: return { label: 'Not granted', tone: 'off' };
  }
}

/** Why a node is in the state it is — the "Origin cascade" column. */
export function originText(node: ResolvedCapability | undefined): string {
  if (!node) return '—';
  switch (node.source) {
    case 'explicit-grant': return 'Direct grant';
    case 'inherited-grant': return node.parentKey ? `Cascaded from ${node.parentKey}` : 'Cascaded';
    case 'explicit-deny': return 'Explicit deny';
    case 'ancestor-denied': return node.deniedBy ? `Blocked by ${node.deniedBy}` : 'Blocked by a denied parent';
    case 'inherited-deny': return 'Parent is off';
    default: return 'No grant (never inherits)';
  }
}

export const KIND_LABEL: Record<CapabilityRow['kind'], string> = {
  tool: 'Tool',
  page: 'Page',
  tab: 'Tab',
  operation: 'OP',
  scope: 'Scope',
};
