'use client';

import { useEffect, useMemo, useState } from 'react';
import { FineTuneColors, InfoTip, LocalDateTime, PageBody, PageHeader, ThemePicker, applyThemePreview } from '@platform/ui-kit';
import {
  DEFAULT_FONT_ID,
  DEFAULT_PRESET_ID,
  findUnreadablePairs,
  resolveTheme,
  sanitizeColorOverrides,
  type ThemeChoice,
} from '@platform/ui-kit/theme';
import {
  BRANDABLE_NAV,
  BRAND_ASSET_CATALOG,
  BRAND_ASSET_DARK_PREVIEW,
  BRAND_ASSET_GROUPS,
  BRAND_TERM_ROWS,
} from '@platform/ui-kit/branding';
import { DEFAULT_LOCALE_CONFIG, createFormatters, localeFromApi } from '@platform/ui-kit/locale';
import { branding as brandingApi, type TenantBrandingView, type TenantBrandingUpdate } from '@/src/lib/api/client';

interface Props {
  initial: TenantBrandingView;
  canManage: boolean;
}

const PRODUCT_ROWS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'lms', label: 'Lead Management' },
  { key: 'hr', label: 'People & Attendance' },
  { key: 'task', label: 'Tasks' },
  { key: 'admin', label: 'Admin Console' },
];

// Unset fields are shown (and saved) as the platform default they inherit,
// so the active swatch / font is always highlighted.
const PLATFORM_DEFAULT: ThemeChoice = { preset: DEFAULT_PRESET_ID, seed_hex: null, font: DEFAULT_FONT_ID, mode: 'light', color_overrides: {} };

function themeOf(v: TenantBrandingView): ThemeChoice {
  const t = v.theme;
  const seed = t?.seed_hex ?? null;
  return {
    preset: seed ? null : ((t?.preset as ThemeChoice['preset']) ?? DEFAULT_PRESET_ID),
    seed_hex: seed,
    font: (t?.font as ThemeChoice['font']) ?? DEFAULT_FONT_ID,
    mode: (t?.mode as ThemeChoice['mode']) ?? 'light',
    color_overrides: sanitizeColorOverrides(t?.color_overrides),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Section({ n, title, subtitle, aside, children }: {
  n: number; title: string; subtitle: string; aside?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-surface-container-lowest p-3 shadow-card sm:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-headline-sm font-semibold text-on-surface">
            {n}. {title}
            <InfoTip label={`About ${title}`}>{subtitle}</InfoTip>
          </h2>
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
  'h-11 w-full sm:h-9 rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-body-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-on-surface-variant';

export default function BrandingSettings({ initial, canManage }: Props) {
  const [saved, setSaved] = useState(initial);
  const [theme, setTheme] = useState<ThemeChoice>(() => themeOf(initial));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => setOrigin(window.location.origin), []);

  const locked = saved.theme_locked;
  const themeEditable = canManage && !locked;

  // The tenant admin's whole remit is colour, font and the default mode. Images,
  // names, words, menu labels and regional formats below are read-only: the
  // platform administrator sets them (the API and the database refuse any other
  // write from this screen).
  const savedTheme = themeOf(saved);
  const themeDirty = themeEditable && !same(theme, savedTheme);
  const dirty = canManage && themeDirty;

  // The same readability floor the server enforces (text must keep 3:1 on its background).
  const effectiveTheme = resolveTheme(theme);
  const unreadable = findUnreadablePairs(effectiveTheme.seed_hex, theme.color_overrides);

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
    setNotice(null);
  };

  const save = async () => {
    if (!dirty || unreadable.length > 0) return;
    setSaving(true);
    setNotice(null);
    const body: TenantBrandingUpdate = {
      preset: theme.seed_hex ? null : (theme.preset ?? null),
      seed_hex: theme.seed_hex ?? null,
      font: theme.font ?? null,
      default_mode: theme.mode ?? 'light',
      color_overrides: theme.color_overrides ?? {},
    };
    try {
      await brandingApi.update(body);
      // The theme is rendered server-side in every product: reload so this
      // console shows the saved result too.
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setNotice({
        kind: 'error',
        text: /locked/i.test(msg)
          ? 'Colours and font were locked by your platform administrator. Discard the colour change and try again.'
          : msg || 'Could not save branding. Please try again.',
      });
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


  const termsSet = BRAND_TERM_ROWS.filter((r) => saved.terms[r.singular] || saved.terms[r.plural]);
  const navSet = BRANDABLE_NAV.flatMap((g) => g.items).filter((i) => saved.nav_overrides[i.id]);
  const loc = localeFromApi(saved.locale_config);
  const fmt = useMemo(() => createFormatters(loc), [loc]);
  const regionalIsDefault = same(loc, DEFAULT_LOCALE_CONFIG);

  return (
    <>
      <PageHeader
        title="Branding"
        subtitle="Choose your colours and font"
        info="Logos, names, wording, menus and regional formats are set by the platform administrator."
        actions={saved.updated_at ? <p className="text-label-sm text-on-surface-variant">Last saved <LocalDateTime value={saved.updated_at} /></p> : undefined}
      />
      <PageBody className="mx-auto flex max-w-5xl flex-col gap-3 !space-y-0 pb-28 sm:pb-28">

      {!canManage && (
        <p className="rounded-lg bg-surface-container px-3 py-2 text-body-sm text-on-surface-variant">
          You can view branding settings. Ask a tenant admin to change them.
        </p>
      )}

      <Section
        n={1}
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
        {!locked && (
          <div className="mt-5">
            <FineTuneColors
              seedHex={effectiveTheme.seed_hex}
              value={theme.color_overrides ?? {}}
              onChange={(next) => setTheme((t) => ({ ...t, color_overrides: next }))}
              disabled={!canManage || saving}
            />
          </div>
        )}
      </Section>

      <Section
        n={2}
        title="Brand identity"
        subtitle="Your logos and icons, product names and login link. Set by the platform administrator — ask them to change any of these."
        aside={<ManagedChip />}
      >
        {BRAND_ASSET_GROUPS.map((g) => (
          <div key={g.id} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-label-md font-semibold uppercase tracking-wide text-on-surface-variant">{g.title}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {BRAND_ASSET_CATALOG.filter((a) => a.group === g.id).map((a) => {
                const src = saved.assets[a.slot];
                const meta = saved.asset_meta[a.slot];
                const dark = BRAND_ASSET_DARK_PREVIEW.has(a.slot);
                return (
                  <div key={a.slot} className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
                    <div className={`flex h-20 items-center justify-center rounded-md ${dark ? 'bg-inverse-surface' : 'bg-surface-container-low'}`}>
                      {src ? (
                        // Gateway-served tenant asset (/api/public/branding/...); plain
                        // <img> so no basePath / optimizer rewriting applies.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api${src}`} alt={`${a.label} preview`} className="max-h-16 max-w-full object-contain" />
                      ) : (
                        <span className={`text-label-sm ${dark ? 'text-inverse-on-surface' : 'text-outline'}`}>Platform default</span>
                      )}
                    </div>
                    <div>
                      <p className="text-label-md font-semibold text-on-surface">{a.label}</p>
                      <p className="text-label-sm text-outline">
                        {meta ? `${meta.content_type?.replace('image/', '').toUpperCase()} · ${Math.max(1, Math.round((meta.bytes ?? 0) / 1024))} KB` : 'Not set'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

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
                className="h-11 shrink-0 rounded-lg border border-outline-variant px-3 text-label-md font-semibold text-primary hover:bg-surface-container-low sm:h-9"
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          ) : (
            <p className="text-body-sm text-outline">Your login link is created when branding is first set up by the platform administrator.</p>
          )}
        </div>
      </Section>

      <Section
        n={3}
        title="Wording, menus & regional formats"
        subtitle="How words, menu items, dates and money appear for everyone in your organisation. Set by the platform administrator."
        aside={<ManagedChip />}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-label-md font-semibold text-on-surface">Terms</h3>
            {termsSet.length ? (
              <ul className="flex flex-col gap-1 text-body-sm">
                {termsSet.map((r) => (
                  <li key={r.singular} className="flex justify-between gap-3 rounded-md bg-surface-container-low px-3 py-1.5">
                    <span className="text-on-surface-variant">{r.label} / {r.pluralLabel}</span>
                    <span className="truncate font-semibold text-on-surface">
                      {saved.terms[r.singular] ?? r.label} / {saved.terms[r.plural] ?? r.pluralLabel}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-outline">Platform terms.</p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-label-md font-semibold text-on-surface">Menu</h3>
            {navSet.length ? (
              <ul className="flex flex-col gap-1 text-body-sm">
                {navSet.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3 rounded-md bg-surface-container-low px-3 py-1.5">
                    <span className="text-on-surface-variant">{i.label}</span>
                    <span className="truncate font-semibold text-on-surface">
                      {saved.nav_overrides[i.id]?.label ?? i.label}
                      {saved.nav_overrides[i.id]?.icon ? ` · ${saved.nav_overrides[i.id]?.icon}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-outline">Platform menu.</p>
            )}
          </div>
        </div>
        <div className="mt-4">
          <h3 className="mb-2 text-label-md font-semibold text-on-surface">Regional formats</h3>
          {regionalIsDefault ? (
            <p className="text-body-sm text-outline">Platform defaults.</p>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm sm:grid-cols-4">
            <div><dt className="text-label-sm text-outline">Date</dt><dd className="font-semibold text-on-surface">{fmt.formatDate('2026-07-05')}</dd></div>
            <div><dt className="text-label-sm text-outline">Time</dt><dd className="font-semibold text-on-surface">{fmt.formatTime('2026-07-05T04:00:00Z')}</dd></div>
            <div><dt className="text-label-sm text-outline">Amount</dt><dd className="font-semibold text-on-surface">{fmt.formatMoney(1234567.5)}</dd></div>
            <div><dt className="text-label-sm text-outline">Time zone</dt><dd className="font-semibold text-on-surface">{loc.timezone}</dd></div>
          </dl>
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
                  className="min-h-[2.75rem] rounded-lg px-3 py-2 text-label-md text-on-surface-variant hover:bg-surface-container disabled:opacity-50 sm:min-h-0"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || unreadable.length > 0}
                  aria-busy={saving}
                  className="min-h-[2.75rem] rounded-lg bg-primary px-4 py-2 text-label-md font-semibold text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      </PageBody>
    </>
  );
}
