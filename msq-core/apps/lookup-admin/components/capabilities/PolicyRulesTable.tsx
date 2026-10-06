'use client';

import { useMemo, useState } from 'react';
import type { ResolvedCapability } from '@platform/rbac';
import type { CapabilityRow } from '@/src/lib/api/client';
import { KIND_LABEL, originText } from '@/src/lib/capability-tree';
import { GrantButtons, StagedChip, StateChip } from './CapabilityParts';

type RuleFilter = 'all' | 'granted' | 'inherited' | 'deny' | 'modified';

const PAGE_SIZE = 50;

interface Props {
  roleLabel: string;
  rows: CapabilityRow[];
  byKey: Map<string, CapabilityRow>;
  resolved: Map<string, ResolvedCapability>;
  pending: Record<string, boolean>;
  onSet: (key: string, granted: boolean) => void;
  onExport: () => void;
}

/** The tool and module a capability sits under, for the "Parent" column. */
export function parentPath(byKey: Map<string, CapabilityRow>, cap: CapabilityRow): { tool: string; module: string } {
  let tool = '';
  let module = '';
  let cur = cap.parent_key ? byKey.get(cap.parent_key) : undefined;
  while (cur) {
    if (cur.kind === 'tool') tool = cur.label;
    else if (cur.kind === 'page' || cur.kind === 'tab') module = cur.label;
    cur = cur.parent_key ? byKey.get(cur.parent_key) : undefined;
  }
  return { tool, module };
}

// The flat, searchable view of every operation and scope the role resolves —
// same toggles as the drilldown, for when you know the key you are after.
export default function PolicyRulesTable({ roleLabel, rows, byKey, resolved, pending, onSet, onExport }: Props) {
  const [filter, setFilter] = useState<RuleFilter>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const counts = useMemo(() => {
    const c = { all: rows.length, granted: 0, inherited: 0, deny: 0, modified: 0 };
    for (const r of rows) {
      const src = resolved.get(r.key)?.source;
      if (src === 'explicit-grant') c.granted += 1;
      else if (src === 'inherited-grant') c.inherited += 1;
      else if (src === 'explicit-deny') c.deny += 1;
      if (r.key in pending) c.modified += 1;
    }
    return c;
  }, [rows, resolved, pending]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const src = resolved.get(r.key)?.source;
      if (filter === 'granted' && src !== 'explicit-grant') return false;
      if (filter === 'inherited' && src !== 'inherited-grant') return false;
      if (filter === 'deny' && src !== 'explicit-deny') return false;
      if (filter === 'modified' && !(r.key in pending)) return false;
      return !needle || r.key.toLowerCase().includes(needle) || r.label.toLowerCase().includes(needle);
    });
  }, [rows, resolved, pending, filter, q]);

  const FILTERS: ReadonlyArray<{ id: RuleFilter; label: string; count: number }> = [
    { id: 'all', label: 'All Rules', count: counts.all },
    { id: 'granted', label: 'Granted', count: counts.granted },
    { id: 'inherited', label: 'Inherited', count: counts.inherited },
    { id: 'deny', label: 'Explicit Deny', count: counts.deny },
    { id: 'modified', label: 'Modified', count: counts.modified },
  ];

  return (
    <section className="space-y-3" aria-label="Configured policy rules">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-on-surface">Configured &amp; Active Policy Rules for {roleLabel}</h2>
          <p className="text-xs text-on-surface-variant">
            Toggle a capability here or through the cascade above — both stage the same change.
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={shown.length === 0}
          className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container disabled:opacity-40"
        >
          Export Matrix
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setLimit(PAGE_SIZE); }}
          placeholder="Search capability, key or scope…"
          aria-label="Search policy rules"
          className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none sm:max-w-sm"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter rules">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => { setFilter(f.id); setLimit(PAGE_SIZE); }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'border-primary bg-primary-fixed text-primary'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
        <table className="w-full text-xs">
          <thead className="bg-surface-container-low text-left text-on-surface-variant">
            <tr>
              <th className="px-3 py-2 font-semibold">Capability</th>
              <th className="px-3 py-2 font-semibold">Parent tool / module</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Origin</th>
              <th className="px-3 py-2 font-semibold">State</th>
              <th className="px-3 py-2 font-semibold">Quick toggle</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-on-surface-variant">No rules match this filter.</td></tr>
            )}
            {shown.slice(0, limit).map((r) => {
              const node = resolved.get(r.key);
              const path = parentPath(byKey, r);
              return (
                <tr key={r.id} className="border-t border-outline-variant align-top">
                  <td className="px-3 py-2">
                    <span className="block font-semibold text-on-surface">{r.label}</span>
                    <span className="block font-mono text-[0.6875rem] text-on-surface-variant">{r.key}</span>
                  </td>
                  <td className="px-3 py-2 text-on-surface-variant">
                    <span className="block text-on-surface">{path.tool}</span>
                    <span className="block">{path.module || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-on-surface-variant">{KIND_LABEL[r.kind]}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{originText(node)}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1">
                      <StateChip node={node} />
                      {r.key in pending && <StagedChip />}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <GrantButtons
                      node={node}
                      label={r.label}
                      disabled={!node || node.source === 'ancestor-denied'}
                      onSet={(g) => onSet(r.key, g)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        <span>Showing {Math.min(limit, shown.length)} of {shown.length} rules</span>
        {shown.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)} className="font-medium text-primary hover:underline">
            Show more
          </button>
        )}
      </div>
    </section>
  );
}
