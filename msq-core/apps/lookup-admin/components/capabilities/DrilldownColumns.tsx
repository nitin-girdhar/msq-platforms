'use client';

import { useMemo, useState } from 'react';
import type { ResolvedCapability } from '@platform/rbac';
import type { CapabilityRow } from '@/src/lib/api/client';
import {
  modulesOf,
  permsUnder,
  rowsOfModule,
  type ChildIndex,
  type ModuleEntry,
} from '@/src/lib/capability-tree';
import { GrantButtons, OpRow, StateChip } from './CapabilityParts';

interface Props {
  index: ChildIndex;
  tools: CapabilityRow[];
  resolved: Map<string, ResolvedCapability>;
  pending: Record<string, boolean>;
  toolKey: string;
  moduleKey: string;
  onTool: (key: string) => void;
  onModule: (key: string) => void;
  onSet: (key: string, granted: boolean) => void;
  onSetMany: (keys: string[], granted: boolean) => void;
}

const matches = (q: string, ...parts: Array<string | null | undefined>) => {
  const needle = q.trim().toLowerCase();
  return !needle || parts.some((p) => p?.toLowerCase().includes(needle));
};

/** Stable id for a column-2 entry; the synthetic direct-operations module shares its tool's key. */
export const moduleId = (m: ModuleEntry) => (m.direct ? `${m.key}#direct` : m.key);

const isInert = (node: ResolvedCapability | undefined) => !node || node.source === 'ancestor-denied';

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      aria-label={label}
      className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
    />
  );
}

function BulkButtons({ keys, onSetMany }: { keys: string[]; onSetMany: (keys: string[], granted: boolean) => void }) {
  return (
    <>
      <button
        type="button"
        disabled={keys.length === 0}
        onClick={() => onSetMany(keys, true)}
        className="shrink-0 rounded-lg border border-outline-variant px-2.5 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container disabled:opacity-40"
      >
        Allow all
      </button>
      <button
        type="button"
        disabled={keys.length === 0}
        onClick={() => onSetMany(keys, false)}
        className="shrink-0 rounded-lg border border-outline-variant px-2.5 py-1.5 text-xs font-medium text-on-surface-variant hover:border-error/50 hover:text-error disabled:opacity-40"
      >
        Deny all
      </button>
    </>
  );
}

function ColumnShell({ step, title, hint, children }: { step: string; title: string; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-low p-3">
      <header>
        <h3 className="text-xs font-semibold text-on-surface">
          <span className="mr-1 text-primary">{step}</span>
          {title}
        </h3>
        {hint && <p className="truncate text-[0.6875rem] text-on-surface-variant">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

// Three-pane drilldown: Tool -> Module/Page -> Operations & Scopes. Below `lg`
// the same data is an accordion, because three side-by-side panes do not fit a
// phone.
export default function DrilldownColumns(props: Props) {
  const { index, tools, resolved, pending, toolKey, moduleKey, onTool, onModule, onSet, onSetMany } = props;
  const [toolQ, setToolQ] = useState('');
  const [moduleQ, setModuleQ] = useState('');
  const [opQ, setOpQ] = useState('');
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [openModule, setOpenModule] = useState<string | null>(null);

  const modules = useMemo(() => modulesOf(index, toolKey), [index, toolKey]);
  const module = modules.find((m) => moduleId(m) === moduleKey) ?? modules[0];
  const rows = useMemo(
    () => (module ? rowsOfModule(index, toolKey, module) : []),
    [index, toolKey, module],
  );
  const shownRows = rows.filter((r) => matches(opQ, r.label, r.key, r.description));
  const shownTools = tools.filter((t) => matches(toolQ, t.label, t.key));
  const shownModules = modules.filter((m) => !m.direct && matches(moduleQ, m.label, m.key));
  const toolKeys = shownTools.filter((t) => !isInert(resolved.get(t.key))).map((t) => t.key);
  const moduleKeys = shownModules.filter((m) => !isInert(resolved.get(m.key))).map((m) => m.key);
  const editable = shownRows.filter((r) => !isInert(resolved.get(r.key))).map((r) => r.key);
  const baseDepth = module && !module.direct ? (resolved.get(module.key)?.depth ?? 0) + 1 : (resolved.get(toolKey)?.depth ?? 0) + 1;

  const renderRow = (cap: CapabilityRow, base: number) => {
    const node = resolved.get(cap.key);
    return (
      <OpRow
        key={cap.id}
        cap={cap}
        node={node}
        staged={cap.key in pending}
        inert={isInert(node)}
        baseDepth={base}
        onSet={(g) => onSet(cap.key, g)}
      />
    );
  };

  const moduleSummary = (m: ModuleEntry) => {
    const count = m.direct
      ? rowsOfModule(index, toolKey, m).filter((r) => r.kind === 'operation' || r.kind === 'scope').length
      : permsUnder(index, m.key).length;
    return `${count} perm${count === 1 ? '' : 's'}`;
  };

  return (
    <>
      {/* Desktop */}
      <div className="hidden gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        <ColumnShell step="1." title="Tools" hint={`${tools.length} tools`}>
          <div className="flex items-center gap-2">
            <SearchBox value={toolQ} onChange={setToolQ} label="Filter tools…" />
            <BulkButtons keys={toolKeys} onSetMany={onSetMany} />
          </div>
          <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto">
            {shownTools.map((t) => {
              const active = t.key === toolKey;
              const node = resolved.get(t.key);
              return (
                <li
                  key={t.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
                    t.key in pending ? 'border-status-due' : active ? 'border-primary' : 'border-outline-variant'
                  } ${active ? 'bg-primary-fixed' : 'bg-surface-container-lowest hover:bg-surface-container'}`}
                >
                  <button type="button" aria-current={active} onClick={() => onTool(t.key)} className="min-w-0 flex-1 px-1 py-0.5 text-left">
                    <span className="block truncate text-xs font-semibold text-on-surface">{t.label}</span>
                    <span className="block truncate font-mono text-[0.6875rem] text-on-surface-variant">{t.key}</span>
                    <span className="text-[0.6875rem] text-on-surface-variant">{permsUnder(index, t.key).length} perms</span>
                  </button>
                  <StateChip node={node} />
                  <GrantButtons node={node} label={t.label} disabled={isInert(node)} onSet={(g) => onSet(t.key, g)} />
                </li>
              );
            })}
          </ul>
        </ColumnShell>

        <ColumnShell step="2." title="Modules / Pages" hint={`in ${tools.find((t) => t.key === toolKey)?.label ?? '—'}`}>
          <div className="flex items-center gap-2">
            <SearchBox value={moduleQ} onChange={setModuleQ} label="Filter modules…" />
            <BulkButtons keys={moduleKeys} onSetMany={onSetMany} />
          </div>
          <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto">
            {modules.length === 0 && <li className="px-1 py-2 text-xs text-on-surface-variant">Nothing beneath this tool.</li>}
            {modules.filter((m) => m.direct || matches(moduleQ, m.label, m.key)).map((m) => {
              const active = !!module && moduleId(module) === moduleId(m);
              const node = m.direct ? undefined : resolved.get(m.key);
              return (
                <li
                  key={`${m.key}:${m.direct}`}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
                    !m.direct && m.key in pending ? 'border-status-due' : active ? 'border-primary' : 'border-outline-variant'
                  } ${active ? 'bg-primary-fixed' : 'bg-surface-container-lowest hover:bg-surface-container'}`}
                >
                  <button type="button" aria-current={active} onClick={() => onModule(moduleId(m))} className="min-w-0 flex-1 px-1 py-0.5 text-left">
                    <span className="block truncate text-xs font-semibold text-on-surface">{m.label}</span>
                    <span className="block truncate font-mono text-[0.6875rem] text-on-surface-variant">{m.key}</span>
                    <span className="text-[0.6875rem] text-on-surface-variant">{moduleSummary(m)}</span>
                  </button>
                  {!m.direct && <StateChip node={node} />}
                  {!m.direct && <GrantButtons node={node} label={m.label} disabled={isInert(node)} onSet={(g) => onSet(m.key, g)} />}
                </li>
              );
            })}
          </ul>
        </ColumnShell>

        <ColumnShell step="3." title="Operations & Scopes" hint={module ? `for ${module.label}` : undefined}>
          <div className="flex items-center gap-2">
            <SearchBox value={opQ} onChange={setOpQ} label="Filter operations…" />
            <BulkButtons keys={editable} onSetMany={onSetMany} />
          </div>
          <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto">
            {shownRows.length === 0 && <li className="px-1 py-2 text-xs text-on-surface-variant">No operations to show.</li>}
            {shownRows.map((cap) => renderRow(cap, baseDepth))}
          </ul>
        </ColumnShell>
      </div>

      {/* Phone / tablet */}
      <div className="space-y-2 lg:hidden">
        {tools.map((t) => {
          const toolOpen = openTool === t.key;
          return (
            <div key={t.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  aria-expanded={toolOpen}
                  onClick={() => setOpenTool(toolOpen ? null : t.key)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-semibold text-on-surface">{t.label}</span>
                  <span className="text-[0.6875rem] text-on-surface-variant">{permsUnder(index, t.key).length} perms</span>
                </button>
                <StateChip node={resolved.get(t.key)} />
                <GrantButtons node={resolved.get(t.key)} label={t.label} disabled={isInert(resolved.get(t.key))} onSet={(g) => onSet(t.key, g)} />
              </div>
              {toolOpen && (
                <div className="space-y-2 border-t border-outline-variant p-2">
                  {modulesOf(index, t.key).map((m) => {
                    const id = `${t.key}:${m.key}:${m.direct}`;
                    const modOpen = openModule === id;
                    const modRows = rowsOfModule(index, t.key, m);
                    const base = m.direct ? (resolved.get(t.key)?.depth ?? 0) + 1 : (resolved.get(m.key)?.depth ?? 0) + 1;
                    return (
                      <div key={id} className="rounded-lg border border-outline-variant">
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button
                            type="button"
                            aria-expanded={modOpen}
                            onClick={() => setOpenModule(modOpen ? null : id)}
                            className="min-w-0 flex-1 text-left text-xs font-semibold text-on-surface"
                          >
                            {m.label}
                            <span className="ml-2 font-normal text-on-surface-variant">{moduleSummary(m)}</span>
                          </button>
                          {!m.direct && <StateChip node={resolved.get(m.key)} />}
                          {!m.direct && (
                            <GrantButtons node={resolved.get(m.key)} label={m.label} disabled={isInert(resolved.get(m.key))} onSet={(g) => onSet(m.key, g)} />
                          )}
                        </div>
                        {modOpen && <ul className="space-y-1.5 p-2">{modRows.map((cap) => renderRow(cap, base))}</ul>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
