'use client';

import { useEffect, useMemo, useState } from 'react';
import { ThemePicker, applyThemePreview } from '@platform/ui-kit';
import { DEFAULT_FONT_ID, DEFAULT_PRESET_ID, resolveTheme, type ThemeChoice } from '@platform/ui-kit/theme';
import {
  BRANDABLE_NAV,
  BRAND_TERM_ROWS,
  NAV_ICON_NAMES,
  NavIcon,
  isNavIconName,
  type NavOverride,
} from '@platform/ui-kit/branding';
import { branding as brandingApi, type TenantBrandingView, type TenantBrandingUpdate } from '@/src/lib/api/client';

interface Props {
  initial: TenantBrandingView;
  canManage: boolean;
}

const ASSET_SLOTS: ReadonlyArray<{ slot: string; label: string; hint: string }> = [
  { slot: 'logo', label: 'Full logo', hint: 'Navbar & login' },
  { slot: 'mark', label: 'Logo mark', hint: 'Sidebar & collapsed rail' },
  { slot: 'favicon', label: 'Favicon', hint: 'Browser tab' },
  { slot: 'app_icon', label: 'App icon', hint: 'Home screen (PWA)' },
];

const PRODUCT_ROWS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'lms', label: 'Lead Management' },
  { key: 'hr', label: 'People & Attendance' },
  { key: 'task', label: 'Tasks' },
  { key: 'admin', label: 'Admin Console' },
];

const TERM_MAX = 24;
const LABEL_MAX = 30;
const MARKUP_RE = /[<>{}]/;

// Unset fields are shown (and saved) as the platform default they inherit,
// so the active swatch / font is always highlighted.
const PLATFORM_DEFAULT: ThemeChoice = { preset: DEFAULT_PRESET_ID, seed_hex: null, font: DEFAULT_FONT_ID, mode: 'light' };

function themeOf(v: TenantBrandingView): ThemeChoice {
  const t = v.theme;
  const seed = t?.seed_hex ?? null;
  return {
    preset: seed ? null : ((t?.preset as ThemeChoice['preset']) ?? DEFAULT_PRESET_ID),
    seed_hex: seed,
    font: (t?.font as ThemeChoice['font']) ?? DEFAULT_FONT_ID,
    mode: (t?.mode as ThemeChoice['mode']) ?? 'light',
  };
}

function cleanRecord(r: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) if (v.trim()) out[k] = v.trim();
  return out;
}

function cleanNav(r: Record<string, NavOverride>): Record<string, NavOverride> {
  const out: Record<string, NavOverride> = {};
  for (const [id, o] of Object.entries(r)) {
    const e: NavOverride = {};
    if (o.label?.trim()) e.label = o.label.trim();
    if (o.icon && isNavIconName(o.icon)) e.icon = o.icon;
    if (e.label || e.icon) out[id] = e;
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Section({ n, title, subtitle, aside, children }: {
  n: number; title: string; subtitle: string; aside?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-surface-container-lowest p-4 shadow-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-headline-sm font-semibold text-on-surface">{n}. {title}</h2>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">{subtitle}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ManagedChip({ text = 'Managed by platform administrator' }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-2.5 py-1 text-label-sm text-on-surface-variant">
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
      </svg>
      {text}
    </span>
  );
}

const inputCls =
  'h-9 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-body-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-on-surface-variant';

export default function BrandingSettings({ initial, canManage }: Props) {
  const [saved, setSaved] = useState(initial);
  const [theme, setTheme] = useState<ThemeChoice>(() => themeOf(initial));
  const [terms, setTerms] = useState<Record<string, string>>(() => ({ ...initial.terms }));
  const [nav, setNav] = useState<Record<string, NavOverride>>(() => ({ ...initial.nav_overrides }));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => setOrigin(window.location.origin), []);

  const locked = saved.theme_locked;
  const themeEditable = canManage && !locked;

  const savedTheme = themeOf(saved);
  const themeDirty = themeEditable && !same(theme, savedTheme);
  const termsDirty = !same(cleanRecord(terms), cleanRecord(saved.terms));
  const navDirty = !same(cleanNav(nav), cleanNav(saved.nav_overrides));
  const dirty = canManage && (themeDirty || termsDirty || navDirty);

  const termErrors = useMemo(() => {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(terms)) {
      if (v.trim().length > TERM_MAX) e[k] = `Max ${TERM_MAX} characters`;
      else if (MARKUP_RE.test(v)) e[k] = 'Must not contain < > { }';
    }
    return e;
  }, [terms]);
  const navErrors = useMemo(() => {
    const e: Record<string, string> = {};
    for (const [k, o] of Object.entries(nav)) {
      const v = o.label ?? '';
      if (v.trim().length > LABEL_MAX) e[k] = `Max ${LABEL_MAX} characters`;
      else if (MARKUP_RE.test(v)) e[k] = 'Must not contain < > { }';
    }
    return e;
  }, [nav]);
  const invalid = Object.keys(termErrors).length > 0 || Object.keys(navErrors).length > 0;

  // Live preview of an unsaved colour / font on this page.
  useEffect(() => {
    if (!themeDirty) {
      applyThemePreview(null);
      return;
    }
    applyThemePreview(resolveTheme(theme));
    return () => applyThemePreview(null);
  }, [theme, themeDirty]);

  const loginLink = saved.public_key && origin ? `${origin}/login?t=${saved.public_key}` : null;

  const discard = () => {
    setTheme(themeOf(saved));
    setTerms({ ...saved.terms });
    setNav({ ...saved.nav_overrides });
    setNotice(null);
  };

  const save = async () => {
    if (!dirty || invalid) return;
    setSaving(true);
    setNotice(null);
    const body: TenantBrandingUpdate = {};
    if (themeDirty) {
      body.preset = theme.seed_hex ? null : (theme.preset ?? null);
      body.seed_hex = theme.seed_hex ?? null;
      body.font = theme.font ?? null;
      body.default_mode = theme.mode ?? 'light';
    }
    if (termsDirty) body.terms = cleanRecord(terms);
    if (navDirty) body.nav_overrides = cleanNav(nav);
    try {
      const res = await brandingApi.update(body);
      // Theme / names / menus are rendered server-side in every product: reload
      // so this console shows the saved result too.
      if (themeDirty || navDirty) {
        window.location.reload();
        return;
      }
      setSaved(res.data);
      setTerms({ ...res.data.terms });
      setNotice({ kind: 'ok', text: 'Branding saved. Users see the changes on their next page load.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setNotice({
        kind: 'error',
        text: /locked/i.test(msg)
          ? 'Colours and font were locked by your platform administrator. Your other changes were not saved — discard the colour change and try again.'
          : msg || 'Could not save branding. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!loginLink) return;
    try {
      await navigator.clipboard.writeText(loginLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const updatedLabel = saved.updated_at
    ? new Date(saved.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-28 sm:p-6 sm:pb-28">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-label-sm uppercase tracking-wider text-outline">Settings</p>
          <h1 className="text-headline-md font-bold text-on-surface">Branding</h1>
          <p className="mt-1 max-w-2xl text-body-sm text-on-surface-variant">
            Customise how your team sees the platform. Logos and product names are managed by the platform administrator.
          </p>
        </div>
        {updatedLabel && <p className="text-label-sm text-outline">Last saved {updatedLabel}</p>}
      </header>

      {!canManage && (
        <p className="rounded-lg bg-surface-container px-3 py-2 text-body-sm text-on-surface-variant">
          You can view branding settings. Ask a tenant admin to change them.
        </p>
      )}

      <Section n={1} title="Brand identity" subtitle="Logos, product names and your login link." aside={<ManagedChip />}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {ASSET_SLOTS.map(({ slot, label, hint }) => {
            const src = saved.assets[slot];
            const meta = saved.asset_meta[slot];
            return (
              <div key={slot} className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
                <div className="flex h-20 items-center justify-center rounded-md bg-surface-container-low">
                  {src ? (
                    // Gateway-served tenant asset (/api/public/branding/...); plain
                    // <img> so no basePath / optimizer rewriting applies.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api${src}`} alt={`${label} preview`} className="max-h-16 max-w-full object-contain" />
                  ) : (
                    <span className="text-label-sm text-outline">Platform default</span>
                  )}
                </div>
                <div>
                  <p className="text-label-md font-semibold text-on-surface">{label}</p>
                  <p className="text-label-sm text-outline">
                    {meta ? `${meta.content_type?.replace('image/', '').toUpperCase()} · ${Math.max(1, Math.round((meta.bytes ?? 0) / 1024))} KB` : hint}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-label-md font-semibold text-on-surface">Product names</h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {saved.product_names['brand']?.['name'] && (
              <li className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm sm:col-span-2">
                <span className="text-on-surface-variant">Brand name</span>
                <span className="truncate font-semibold text-on-surface">{saved.product_names['brand']['name']}</span>
              </li>
            )}
            {PRODUCT_ROWS.map(({ key, label }) => (
              <li key={key} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm">
                <span className="text-on-surface-variant">{label}</span>
                <span className="truncate font-semibold text-on-surface">{saved.product_names[key]?.['title'] ?? 'Platform default'}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5">
          <h3 className="mb-1 text-label-md font-semibold text-on-surface">Login link</h3>
          <p className="mb-2 text-body-sm text-on-surface-variant">
            Share this link so your team sees your branding on the sign-in page. It is managed and rotated by the platform administrator.
          </p>
          {loginLink ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input readOnly value={loginLink} aria-label="Login link" className={`${inputCls} font-mono`} onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                onClick={copyLink}
                className="h-9 shrink-0 rounded-lg border border-outline-variant px-3 text-label-md font-semibold text-primary hover:bg-surface-container-low"
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          ) : (
            <p className="text-body-sm text-outline">Your login link is created when branding is first saved.</p>
          )}
        </div>
      </Section>

      <Section
        n={2}
        title="Colours & font"
        subtitle="Accent colour, typeface and the default light/dark mode for everyone in your company."
        aside={locked ? <ManagedChip text="Locked by platform administrator" /> : undefined}
      >
        <ThemePicker
          value={theme}
          onChange={setTheme}
          locked={locked}
          lockedReason="Colours and font are locked by your platform administrator. Contact them to unlock tenant theming."
          showMode
          modeLabel="Default mode"
          modeHint="Users can still choose their own mode in Appearance."
          disabled={!canManage || saving}
        />
        {themeEditable && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme({ ...PLATFORM_DEFAULT })}
              className="rounded-lg px-3 py-1.5 text-label-md text-on-surface-variant hover:bg-surface-container"
            >
              Reset to platform default
            </button>
            <p className="text-label-sm text-outline">
              Status colours (overdue, due, converted) stay fixed so urgency reads the same everywhere.
            </p>
          </div>
        )}
      </Section>

      <Section
        n={3}
        title="Terms"
        subtitle="Rename everyday words in menus and screens. Reports, exports, API fields and permissions are unaffected."
        aside={
          canManage && Object.keys(cleanRecord(terms)).length > 0 ? (
            <button type="button" onClick={() => setTerms({})} className="rounded-lg px-3 py-1.5 text-label-md text-on-surface-variant hover:bg-surface-container">
              Reset all terms
            </button>
          ) : undefined
        }
      >
        <div className="hidden grid-cols-[1.2fr_1fr_1fr_auto] gap-3 px-1 pb-2 text-label-sm uppercase tracking-wider text-outline md:grid">
          <span>Default</span>
          <span>Singular</span>
          <span>Plural</span>
          <span className="w-16" />
        </div>
        <ul className="flex flex-col divide-y divide-outline-variant/60">
          {BRAND_TERM_ROWS.map((row) => {
            const custom = Boolean(terms[row.singular]?.trim() || terms[row.plural]?.trim());
            return (
              <li key={row.singular} className="grid grid-cols-2 items-start gap-3 py-3 md:grid-cols-[1.2fr_1fr_1fr_auto]">
                <div className="col-span-2 md:col-span-1">
                  <p className="text-body-md font-semibold text-on-surface">{row.label} / {row.pluralLabel}</p>
                  <p className="text-label-sm text-outline">e.g. {row.example}</p>
                </div>
                {([['singular', row.label], ['plural', row.pluralLabel]] as const).map(([which, ph]) => {
                  const key = which === 'singular' ? row.singular : row.plural;
                  return (
                    <label key={key} className="flex flex-col gap-1">
                      <span className="text-label-sm text-on-surface-variant md:sr-only">{which === 'singular' ? 'Singular' : 'Plural'}</span>
                      <input
                        value={terms[key] ?? ''}
                        placeholder={ph}
                        maxLength={TERM_MAX + 8}
                        disabled={!canManage || saving}
                        aria-invalid={Boolean(termErrors[key])}
                        onChange={(e) => setTerms((t) => ({ ...t, [key]: e.target.value }))}
                        className={inputCls}
                      />
                      {termErrors[key] && <span className="text-label-sm text-error">{termErrors[key]}</span>}
                    </label>
                  );
                })}
                <div className="col-span-2 flex justify-end md:col-span-1 md:w-16 md:pt-1.5">
                  {canManage && custom ? (
                    <button
                      type="button"
                      onClick={() => setTerms((t) => {
                        const n = { ...t };
                        delete n[row.singular];
                        delete n[row.plural];
                        return n;
                      })}
                      className="text-label-md text-primary hover:underline"
                    >
                      Reset
                    </button>
                  ) : (
                    <span className="text-label-sm text-outline">{custom ? 'Custom' : 'Default'}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        n={4}
        title="Menu labels & icons"
        subtitle="Rename menu items or pick a different icon. Menu order, pages and who can open them do not change."
      >
        <div className="flex flex-col gap-5">
          {BRANDABLE_NAV.map((group) => (
            <div key={group.product}>
              <h3 className="mb-2 text-label-md font-semibold text-on-surface">{group.label}</h3>
              <ul className="flex flex-col divide-y divide-outline-variant/60 rounded-lg border border-outline-variant">
                {group.items.map((item) => {
                  const o = nav[item.id] ?? {};
                  const icon = o.icon && isNavIconName(o.icon) ? o.icon : item.icon;
                  const custom = Boolean(o.label?.trim() || o.icon);
                  return (
                    <li key={item.id} className="grid grid-cols-[auto_1fr] items-center gap-3 px-3 py-2.5 sm:grid-cols-[auto_1fr_12rem_auto]">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant">
                        <NavIcon name={icon} className="h-5 w-5" />
                      </span>
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="sr-only">Label for {item.label}</span>
                        <input
                          value={o.label ?? ''}
                          placeholder={item.label}
                          maxLength={LABEL_MAX + 8}
                          disabled={!canManage || saving}
                          aria-invalid={Boolean(navErrors[item.id])}
                          onChange={(e) => setNav((n) => ({ ...n, [item.id]: { ...n[item.id], label: e.target.value } }))}
                          className={inputCls}
                        />
                        {navErrors[item.id] && <span className="text-label-sm text-error">{navErrors[item.id]}</span>}
                      </label>
                      <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                        <span className="sr-only">Icon for {item.label}</span>
                        <select
                          value={o.icon ?? ''}
                          disabled={!canManage || saving}
                          onChange={(e) => setNav((n) => {
                            const next: NavOverride = { ...n[item.id] };
                            if (e.target.value) next.icon = e.target.value;
                            else delete next.icon;
                            return { ...n, [item.id]: next };
                          })}
                          className={inputCls}
                        >
                          <option value="">Default icon ({item.icon})</option>
                          {NAV_ICON_NAMES.map((name) => (
                            <option key={name} value={name}>{name.replace(/-/g, ' ')}</option>
                          ))}
                        </select>
                      </label>
                      <div className="col-span-2 flex justify-end sm:col-span-1 sm:w-14">
                        {canManage && custom && (
                          <button
                            type="button"
                            onClick={() => setNav((n) => {
                              const next = { ...n };
                              delete next[item.id];
                              return next;
                            })}
                            className="text-label-md text-primary hover:underline"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {canManage && (dirty || notice) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant bg-surface-container-lowest/95 px-4 py-3 shadow-overlay backdrop-blur lg:left-auto lg:right-6 lg:bottom-6 lg:w-auto lg:rounded-xl lg:border">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {notice && (
              <p
                role={notice.kind === 'error' ? 'alert' : 'status'}
                className={`text-body-sm ${notice.kind === 'error' ? 'text-error' : 'text-on-surface-variant'} sm:mr-auto lg:mr-4 lg:max-w-md`}
              >
                {notice.text}
              </p>
            )}
            {dirty && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={discard}
                  disabled={saving}
                  className="rounded-lg px-3 py-2 text-label-md text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || invalid}
                  aria-busy={saving}
                  className="rounded-lg bg-primary px-4 py-2 text-label-md font-semibold text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
