'use client';

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { buildFullScheme, contrastRatio, derivedRoleColors, findUnreadablePairs } from '../../theme/scheme';
import {
  COLOR_CONTRAST_PAIRS,
  COLOR_ROLE_GROUPS,
  CONTRAST_BLOCK,
  CONTRAST_WARN,
  type ColorOverrides,
  type ColorRoleId,
  type RoleOverrides,
} from '../../theme/roles';

type Mode = 'light' | 'dark';

export interface FineTuneColorsProps {
  /** The seed the shades are derived from (the picked preset's seed, or the custom colour). */
  seedHex: string;
  /** The overrides being edited, as they apply (sparse, per mode). */
  value: ColorOverrides;
  onChange: (next: ColorOverrides) => void;
  /**
   * What sits beneath this editor and what "Reset" returns to: nothing for the company's
   * own editor; the company's shades for a user who kept the company seed.
   */
  base?: ColorOverrides;
  disabled?: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;

function mix(a: string, b: string, t: number): string {
  const A = parseInt(a.slice(1), 16);
  const B = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((A >> shift) & 255) * (1 - t) + ((B >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}
/** Nearest shade of `fg` that reads on `bg` (moves toward black or white, whichever the background allows). */
function suggestReadable(fg: string, bg: string): string {
  const target = contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff';
  for (let t = 0.02; t <= 1.0001; t += 0.02) {
    const c = mix(fg, target, t);
    if (contrastRatio(c, bg) >= CONTRAST_WARN) return c;
  }
  return target;
}

const ghostBtn =
  'rounded-lg px-3 py-1.5 text-label-md text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40';

function RoleRow({
  label, hint, value, derived, custom, disabled, onPick, onReset,
}: {
  label: string; hint: string; value: string; derived: string; custom: boolean; disabled: boolean;
  onPick: (hex: string) => void; onReset: () => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? value;
  const bad = typed !== null && !HEX.test(typed);
  return (
    <div className="flex items-center gap-2 border-b border-outline-variant/60 py-1.5 last:border-b-0">
      <span className={`h-2 w-2 shrink-0 rounded-full ${custom ? 'bg-status-due' : 'bg-transparent'}`} title={custom ? 'Customised' : undefined} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-label-md font-semibold text-on-surface">{label}</p>
        <p className="truncate text-label-sm text-outline">{hint} · auto <span className="font-mono">{derived}</span></p>
      </div>
      <input
        type="color"
        aria-label={`${label} colour`}
        disabled={disabled}
        value={value}
        onChange={(e) => { setTyped(null); onPick(e.target.value.toLowerCase()); }}
        className="h-8 w-10 cursor-pointer rounded border border-outline-variant bg-surface-container-lowest p-0.5 disabled:cursor-not-allowed"
      />
      <input
        type="text"
        aria-label={`${label} hex value`}
        disabled={disabled}
        maxLength={7}
        spellCheck={false}
        value={shown}
        onChange={(e) => { setTyped(e.target.value); if (HEX.test(e.target.value)) onPick(e.target.value.toLowerCase()); }}
        onBlur={() => setTyped(null)}
        className={`h-8 w-24 rounded-lg border bg-surface-container-lowest px-2 font-mono text-body-sm text-on-surface focus:outline-none disabled:cursor-not-allowed ${bad ? 'border-error' : 'border-outline-variant focus:border-primary'}`}
      />
      <button type="button" disabled={disabled || !custom} onClick={onReset} className={ghostBtn}>Reset</button>
    </div>
  );
}

/** A miniature app drawn ONLY with theme tokens, scoped by CSS variables so it never recolours the page around it. */
function PreviewPanel({ seedHex, mode, overrides }: { seedHex: string; mode: Mode; overrides: RoleOverrides }) {
  const style = buildFullScheme(seedHex, mode === 'dark', overrides) as CSSProperties;
  const pill = 'rounded-full px-2 py-0.5 text-label-sm font-semibold';
  return (
    <div style={style} className="overflow-hidden rounded-xl border border-outline-variant bg-background font-sans text-on-surface">
      <div className="flex">
        <div className="hidden w-32 shrink-0 flex-col gap-1 bg-surface-container-low p-2 sm:flex">
          <span className="mb-1 flex items-center gap-1.5 text-label-md font-bold"><i className="block h-5 w-5 rounded bg-primary" />Brand</span>
          {['Dashboard', 'Leads', 'Reports'].map((n, i) => (
            <span key={n} className={`rounded-md px-2 py-1 text-label-md ${i === 0 ? 'bg-primary-container font-semibold text-on-primary-container' : 'text-on-surface-variant'}`}>{n}</span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-outline-variant bg-surface px-3 py-2">
            <span className="rounded-md border border-outline-variant bg-surface-container px-2 py-1 text-label-sm text-on-surface-variant">Search…</span>
            <span className={`${pill} bg-primary-container text-on-primary-container`}>Head Office</span>
          </div>
          <div className="flex flex-col gap-3 p-3">
            <div>
              <p className="text-headline-md font-semibold">Today</p>
              <p className="text-body-sm text-on-surface-variant">Secondary text on the page. <span className="font-semibold text-primary underline">A link</span></p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[['New', '128'], ['Due', '34'], ['Won', '19']].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2">
                  <p className="text-label-sm text-on-surface-variant">{k}</p>
                  <p className="text-headline-md font-semibold">{v}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-lg bg-primary px-3 py-1.5 text-label-md font-semibold text-on-primary">Primary</span>
              <span className="rounded-lg bg-secondary-container px-3 py-1.5 text-label-md font-semibold text-on-secondary-container">Secondary</span>
              <span className="rounded-lg bg-tertiary-container px-3 py-1.5 text-label-md font-semibold text-on-tertiary-container">Tertiary</span>
              <span className="rounded-lg border border-outline px-3 py-1.5 text-label-md font-semibold text-primary">Outlined</span>
              <span className="rounded-lg bg-error px-3 py-1.5 text-label-md font-semibold text-on-error">Delete</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-lg border border-outline bg-surface px-2 py-1 text-body-sm"><span className="block text-label-sm text-on-surface-variant">Full name</span>Asha Verma</span>
              <span className={`${pill} bg-primary-container text-on-primary-container`}>New</span>
              <span className={`${pill} bg-secondary-container text-on-secondary-container`}>Contacted</span>
              <span className={`${pill} bg-tertiary-container text-on-tertiary-container`}>Trial</span>
              <span className={`${pill} bg-status-overdue-container text-on-status-overdue-container`}>Overdue</span>
              <span className={`${pill} bg-status-due-container text-on-status-due-container`}>Due</span>
              <span className={`${pill} bg-status-success-container text-on-status-success-container`}>Done</span>
            </div>
            <table className="w-full border-collapse overflow-hidden rounded-lg text-body-sm">
              <thead>
                <tr className="bg-surface-container-high text-left text-label-sm text-on-surface-variant">
                  <th className="p-1.5">Lead</th><th className="p-1.5">Stage</th><th className="p-1.5">Owner</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-outline-variant"><td className="p-1.5">Rohit Mehra</td><td className="p-1.5">New</td><td className="p-1.5">Anita</td></tr>
                <tr className="border-t border-outline-variant bg-surface-container-low"><td className="p-1.5">Kavya Rao</td><td className="p-1.5">Contacted</td><td className="p-1.5">Vikram</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Readability({ eff, onFix, disabled }: { eff: Record<ColorRoleId, string>; onFix: (role: ColorRoleId, hex: string) => void; disabled: boolean }) {
  const rows = COLOR_CONTRAST_PAIRS.map(([fg, bg, label]) => ({ fg, bg, label, f: eff[fg], b: eff[bg], r: contrastRatio(eff[fg], eff[bg]) }));
  const blocked = rows.filter((x) => x.r < CONTRAST_BLOCK).length;
  const warned = rows.filter((x) => x.r >= CONTRAST_BLOCK && x.r < CONTRAST_WARN).length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-label-md font-semibold text-on-surface">Readability</h4>
        <span
          role="status"
          className={`rounded-full px-2 py-0.5 text-label-sm font-semibold ${blocked ? 'bg-error-container text-on-error-container' : warned ? 'bg-status-due-container text-on-status-due-container' : 'bg-status-success-container text-on-status-success-container'}`}
        >
          {blocked ? `${blocked} block saving` : warned ? `${warned} warning${warned > 1 ? 's' : ''}` : 'All readable'}
        </span>
      </div>
      <ul className="flex flex-col">
        {rows.map((x) => (
          <li key={`${x.fg}-${x.bg}`} className="flex items-center gap-2 border-b border-outline-variant/60 py-1 last:border-b-0">
            {/* The swatch IS the data: the two colours being compared. */}
            <span className="flex h-7 w-11 shrink-0 items-center justify-center rounded-md text-label-md font-bold" style={{ background: x.b, color: x.f }}>Aa</span>
            <span className="min-w-0 flex-1 truncate text-label-md text-on-surface">{x.label}</span>
            <span className={`text-label-sm font-semibold ${x.r < CONTRAST_BLOCK ? 'text-error' : x.r < CONTRAST_WARN ? 'text-on-status-due-container' : 'text-on-status-success-container'}`}>{x.r.toFixed(1)}:1</span>
            {x.r < CONTRAST_WARN && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onFix(x.fg, suggestReadable(x.f, x.b) )}
                className="rounded-md border border-outline-variant px-2 py-0.5 text-label-sm font-semibold text-primary hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40"
              >
                Fix
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-label-sm text-outline">{CONTRAST_WARN}:1 or more passes. Between {CONTRAST_BLOCK} and {CONTRAST_WARN} warns. Below {CONTRAST_BLOCK} cannot be saved.</p>
    </div>
  );
}

/**
 * "Fine-tune colours": hand-adjust individual colour roles on top of the seed. Collapsed
 * until opened. Controlled and stateless apart from its own open/mode UI state — the host
 * owns the value, the save and the live page preview (applyThemePreview). Light and dark
 * are edited separately. Error and status colours are not editable.
 */
export default function FineTuneColors({ seedHex, value, onChange, base, disabled = false }: FineTuneColorsProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('light');
  const derived = useMemo(() => derivedRoleColors(seedHex, mode === 'dark'), [seedHex, mode]);
  const cur: RoleOverrides = value[mode] ?? {};
  const baseMode: RoleOverrides = base?.[mode] ?? {};
  const eff = { ...derived, ...cur } as Record<ColorRoleId, string>;

  const changed = (m: Mode) => {
    const v = value[m] ?? {};
    const b = base?.[m] ?? {};
    return Object.keys({ ...v, ...b }).filter((k) => v[k as ColorRoleId] !== b[k as ColorRoleId]).length;
  };
  const count = changed('light') + changed('dark');
  const unreadable = useMemo(() => findUnreadablePairs(seedHex, value), [seedHex, value]);

  const commit = (next: RoleOverrides) => {
    const out: ColorOverrides = { ...value };
    if (Object.keys(next).length) out[mode] = next; else delete out[mode];
    onChange(out);
  };
  const pick = (role: ColorRoleId, hex: string) => {
    // Equal to the shade the seed already gives (and nothing beneath says otherwise): not an override.
    if (hex === derived[role] && !baseMode[role]) {
      const { [role]: _drop, ...rest } = cur;
      commit(rest);
    } else {
      commit({ ...cur, [role]: hex });
    }
  };
  const reset = (role: ColorRoleId) => {
    const { [role]: _drop, ...rest } = cur;
    commit(baseMode[role] ? { ...rest, [role]: baseMode[role] } : rest);
  };

  return (
    <div className="@container border-t border-outline-variant pt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${uid}-body`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-surface-container-low"
      >
        <span>
          <span className="block text-label-md font-semibold text-on-surface">Fine-tune colours <span className="font-normal text-outline">(optional)</span></span>
          <span className="block text-body-sm text-on-surface-variant">Every shade follows your accent colour automatically. Open this only if you need an exact brand match.</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {count > 0 && <span className="rounded-full bg-status-due-container px-2 py-0.5 text-label-sm font-semibold text-on-status-due-container">{count} customised</span>}
          {unreadable.length > 0 && <span className="rounded-full bg-error-container px-2 py-0.5 text-label-sm font-semibold text-on-error-container">Cannot save</span>}
          <svg className={`h-5 w-5 text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </span>
      </button>

      {open && (
        <div id={`${uid}-body`} className="mt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-sm text-outline">Light and dark are edited separately — a colour that works as a button in light mode is rarely right in dark.</p>
            <div className="flex items-center gap-2">
              <div role="radiogroup" aria-label="Mode being edited" className="inline-flex rounded-lg bg-surface-container p-1">
                {(['light', 'dark'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={`rounded-md px-3 py-1 text-label-md ${mode === m ? 'bg-surface-container-lowest font-semibold text-primary shadow-card' : 'text-on-surface-variant hover:text-on-surface'}`}
                  >
                    {m === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
              <button type="button" disabled={disabled || !changed(mode)} onClick={() => commit({ ...baseMode })} className={ghostBtn}>Reset all</button>
            </div>
          </div>

          {unreadable.length > 0 && (
            <p role="alert" className="mb-3 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
              Some text would be unreadable ({unreadable.slice(0, 3).map((u) => `${u.label} ${u.ratio}:1 in ${u.mode}`).join(', ')}{unreadable.length > 3 ? '…' : ''}). Use Fix in the Readability list before saving.
            </p>
          )}

          <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="max-h-[38rem] overflow-y-auto rounded-lg border border-outline-variant px-3 pb-2">
              {COLOR_ROLE_GROUPS.map((g) => (
                <div key={g.id}>
                  <h4 className="sticky top-0 z-[1] bg-surface-container-lowest pb-1 pt-3 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{g.title}</h4>
                  {g.roles.map((r) => (
                    <RoleRow
                      key={r.id}
                      label={r.label}
                      hint={r.hint}
                      value={eff[r.id]}
                      derived={derived[r.id]}
                      custom={cur[r.id] !== baseMode[r.id]}
                      disabled={disabled}
                      onPick={(hex) => pick(r.id, hex)}
                      onReset={() => reset(r.id)}
                    />
                  ))}
                </div>
              ))}
              <h4 className="pb-1 pt-3 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Fixed for every company</h4>
              <p className="pb-1 text-body-sm text-outline">Error, overdue, due, success and info colours stay the same everywhere so urgency always reads the same.</p>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <h4 className="mb-2 text-label-md font-semibold text-on-surface">Preview <span className="font-normal text-outline">({mode} mode)</span></h4>
                <PreviewPanel seedHex={seedHex} mode={mode} overrides={cur} />
              </div>
              <Readability eff={eff} disabled={disabled} onFix={(role, hex) => pick(role, hex)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
