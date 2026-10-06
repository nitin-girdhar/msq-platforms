'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Modal, PageBody, PageHeader, ThemePicker } from '@platform/ui-kit';
import { DEFAULT_FONT_ID, DEFAULT_PRESET_ID, type ThemeChoice } from '@platform/ui-kit/theme';
import {
  NAV_ICON_NAMES,
  NavIcon,
  isNavIconName,
  type NavOverride,
  BRANDABLE_NAV,
  BRAND_ASSET_CATALOG as ASSETS,
  BRAND_ASSET_DARK_PREVIEW as DARK_PREVIEW,
  BRAND_ASSET_GROUPS as ASSET_GROUPS,
  BRAND_ASSET_NEED_LABEL as NEED_LABEL,
  BRAND_TERM_ROWS,
} from '@platform/ui-kit/branding';
import {
  CURRENCY_IDS,
  DATE_FORMAT_IDS,
  DEFAULT_LOCALE_CONFIG,
  LOCALE_IDS,
  NUMBER_GROUPING_IDS,
  PHONE_COUNTRY_CODES,
  TIME_FORMAT_IDS,
  WEEK_START_IDS,
  createFormatters,
  localeFromApi,
} from '@platform/ui-kit/locale';
import { saBranding, type BrandAssetSlot, type SaBrandingUpdate, type SaBrandingView } from '@/src/lib/api/client';

interface Props {
  tenantId: string;
  initial: SaBrandingView;
}

// Upload rules mirror identity-service lib/brand-assets.ts (the real gate);
// checked here only so an obviously wrong file fails before the upload.

const PRODUCTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'lms', label: 'Lead Management' },
  { key: 'hr', label: 'People & Attendance' },
  { key: 'task', label: 'Tasks' },
  { key: 'admin', label: 'Admin Console' },
];

const NAME_FIELDS: ReadonlyArray<{ field: string; label: string; max: number; hint: string }> = [
  { field: 'title', label: 'Title', max: 60, hint: 'Sidebar / navbar' },
  { field: 'tab_title', label: 'Browser tab', max: 60, hint: 'Defaults to title' },
  { field: 'short', label: 'Short name', max: 12, hint: 'Home screen label' },
  { field: 'switcher', label: 'Switcher label', max: 20, hint: 'Product switcher' },
];

const MARKUP_RE = /[<>{}]/;

function themeOf(v: SaBrandingView): ThemeChoice {
  const t = v.theme;
  const seed = t?.seed_hex ?? null;
  return {
    preset: seed ? null : ((t?.preset as ThemeChoice['preset']) ?? DEFAULT_PRESET_ID),
    seed_hex: seed,
    font: (t?.font as ThemeChoice['font']) ?? DEFAULT_FONT_ID,
    mode: (t?.mode as ThemeChoice['mode']) ?? 'light',
  };
}

function cleanNames(n: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [k, fields] of Object.entries(n)) {
    const f: Record<string, string> = {};
    for (const [fk, v] of Object.entries(fields ?? {})) if (v?.trim()) f[fk] = v.trim();
    if (Object.keys(f).length) out[k] = f;
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const TERM_MAX = 24;
const LABEL_MAX = 30;

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

// Regional formats are stored as deviations from the platform default only, so a
// tenant nobody touched keeps '{}' and sees exactly today's behaviour.
function cleanLocale(l: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const defaults = DEFAULT_LOCALE_CONFIG as unknown as Record<string, string | number>;
  for (const [k, v] of Object.entries(l)) if (k in defaults && v !== defaults[k]) out[k] = v;
  return out;
}

const localeState = (v: { locale_config: Record<string, string | number> }) =>
  ({ ...localeFromApi(v.locale_config) } as unknown as Record<string, string | number>);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LOCALE_LABEL: Record<string, string> = {
  'en-IN': 'English (India)', 'en-GB': 'English (UK)', 'en-US': 'English (US)', 'en-AE': 'English (UAE)',
  'en-SG': 'English (Singapore)', 'en-AU': 'English (Australia)', 'hi-IN': 'Hindi (India)',
};
const WEEK_LABEL: Record<string, string> = { monday: 'Monday', sunday: 'Sunday', saturday: 'Saturday' };
const GROUPING_LABEL: Record<string, string> = { indian: 'Indian (12,34,567)', international: 'International (1,234,567)' };

function timeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list?.length) return list;
  } catch { /* fall through to the default */ }
  return [DEFAULT_LOCALE_CONFIG.timezone];
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

const inputCls =
  'h-11 sm:h-9 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-body-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none disabled:opacity-60';

function Card({ title, subtitle, aside, children }: { title: string; subtitle: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-surface-container-lowest p-4 shadow-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-headline-sm font-semibold text-on-surface">{title}</h2>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">{subtitle}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function TenantBrandingClient({ tenantId, initial }: Props) {
  const [saved, setSaved] = useState(initial);
  const [theme, setTheme] = useState<ThemeChoice>(() => themeOf(initial));
  const [locked, setLocked] = useState(initial.theme_locked);
  const [names, setNames] = useState<Record<string, Record<string, string>>>(() => structuredClone(initial.product_names));
  const [terms, setTerms] = useState<Record<string, string>>(() => ({ ...initial.terms }));
  const [nav, setNav] = useState<Record<string, NavOverride>>(() => ({ ...initial.nav_overrides }));
  const [localeCfg, setLocaleCfg] = useState<Record<string, string | number>>(() => localeState(initial));
  const [saving, setSaving] = useState(false);
  const [busySlot, setBusySlot] = useState<BrandAssetSlot | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const fileInputs = useRef<Partial<Record<BrandAssetSlot, HTMLInputElement | null>>>({});

  useEffect(() => setOrigin(window.location.origin), []);

  const themeDirty = !same(theme, themeOf(saved));
  const lockDirty = locked !== saved.theme_locked;
  const namesDirty = !same(cleanNames(names), cleanNames(saved.product_names));
  const termsDirty = !same(cleanRecord(terms), cleanRecord(saved.terms));
  const navDirty = !same(cleanNav(nav), cleanNav(saved.nav_overrides));
  const localeDirty = !same(cleanLocale(localeCfg), cleanLocale(saved.locale_config ?? {}));
  const dirty = themeDirty || lockDirty || namesDirty || termsDirty || navDirty || localeDirty;
  const previewFormatters = useMemo(() => createFormatters(localeFromApi(localeCfg)), [localeCfg]);
  const zones = useMemo(timeZones, []);

  const nameErrors: Record<string, string> = {};
  for (const [k, fields] of Object.entries(names)) {
    for (const [fk, v] of Object.entries(fields ?? {})) {
      const max = k === 'brand' ? 40 : (NAME_FIELDS.find((f) => f.field === fk)?.max ?? 60);
      if ((v ?? '').trim().length > max) nameErrors[`${k}.${fk}`] = `Max ${max} characters`;
      else if (MARKUP_RE.test(v ?? '')) nameErrors[`${k}.${fk}`] = 'Must not contain < > { }';
    }
  }
  const termErrors: Record<string, string> = {};
  for (const [k, v] of Object.entries(terms)) {
    if (v.trim().length > TERM_MAX) termErrors[k] = `Max ${TERM_MAX} characters`;
    else if (MARKUP_RE.test(v)) termErrors[k] = 'Must not contain < > { }';
  }
  const navErrors: Record<string, string> = {};
  for (const [k, o] of Object.entries(nav)) {
    const v = o.label ?? '';
    if (v.trim().length > LABEL_MAX) navErrors[k] = `Max ${LABEL_MAX} characters`;
    else if (MARKUP_RE.test(v)) navErrors[k] = 'Must not contain < > { }';
  }
  const invalid = Object.keys(nameErrors).length > 0 || Object.keys(termErrors).length > 0 || Object.keys(navErrors).length > 0;

  const adopt = (v: SaBrandingView) => {
    setSaved(v);
    setTheme(themeOf(v));
    setLocked(v.theme_locked);
    setNames(structuredClone(v.product_names));
    setTerms({ ...v.terms });
    setNav({ ...v.nav_overrides });
    setLocaleCfg(localeState(v));
  };

  const setName = (product: string, field: string, value: string) =>
    setNames((n) => ({ ...n, [product]: { ...(n[product] ?? {}), [field]: value } }));

  const save = async () => {
    if (!dirty || invalid) return;
    setSaving(true);
    setNotice(null);
    const body: SaBrandingUpdate = {};
    if (themeDirty) {
      body.preset = theme.seed_hex ? null : (theme.preset ?? null);
      body.seed_hex = theme.seed_hex ?? null;
      body.font = theme.font ?? null;
      body.default_mode = theme.mode ?? 'light';
    }
    if (lockDirty) body.theme_locked = locked;
    if (namesDirty) body.product_names = cleanNames(names);
    if (termsDirty) body.terms = cleanRecord(terms);
    if (navDirty) body.nav_overrides = cleanNav(nav);
    if (localeDirty) body.locale_config = cleanLocale(localeCfg);
    try {
      const res = await saBranding.update(tenantId, body);
      adopt(res.data);
      setNotice({ kind: 'ok', text: 'Branding saved. The tenant’s users see it on their next page load.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save branding.' });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (slot: BrandAssetSlot, file: File) => {
    const spec = ASSETS.find((a) => a.slot === slot);
    if (spec && file.size > spec.maxKb * 1024) {
      setNotice({ kind: 'error', text: `${spec.label} must be ${spec.maxKb} KB or smaller.` });
      return;
    }
    setBusySlot(slot);
    setNotice(null);
    try {
      const res = await saBranding.uploadAsset(tenantId, slot, await readAsBase64(file));
      // Keep unsaved theme/name edits; only the asset fields change.
      setSaved((s) => ({ ...s, assets: res.data.assets, asset_meta: res.data.asset_meta, public_key: res.data.public_key, updated_at: res.data.updated_at }));
      setNotice({ kind: 'ok', text: `${spec?.label ?? 'Asset'} uploaded.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Upload failed.' });
    } finally {
      setBusySlot(null);
      const input = fileInputs.current[slot];
      if (input) input.value = '';
    }
  };

  const removeAsset = async (slot: BrandAssetSlot) => {
    setBusySlot(slot);
    setNotice(null);
    try {
      const res = await saBranding.deleteAsset(tenantId, slot);
      setSaved((s) => ({ ...s, assets: res.data.assets, asset_meta: res.data.asset_meta, updated_at: res.data.updated_at }));
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not remove the asset.' });
    } finally {
      setBusySlot(null);
    }
  };

  const rotate = async () => {
    setRotating(true);
    try {
      const res = await saBranding.rotateKey(tenantId);
      setSaved((s) => ({ ...s, public_key: res.data.public_key }));
      setConfirmRotate(false);
      setNotice({ kind: 'ok', text: 'Login link rotated. The old link now shows the platform default.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not rotate the link.' });
      setConfirmRotate(false);
    } finally {
      setRotating(false);
    }
  };

  const loginLink = saved.public_key && origin ? `${origin}/login?t=${saved.public_key}` : null;
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

  const requiredSlots = ASSETS.filter((a) => a.need === 'required');
  const requiredDone = requiredSlots.filter((a) => saved.assets[a.slot]).length;
  const uploadedCount = ASSETS.filter((a) => saved.assets[a.slot]).length;

  return (
    <>
      <PageHeader
        title="Tenant branding"
        subtitle={`${saved.tenant_name} · logos, names, wording, menus, regional formats, colours and the tenant login link`}
        actions={<Link href="/dashboard/branding" className="inline-flex min-h-[2.75rem] items-center text-xs font-semibold text-primary hover:underline sm:min-h-0">← All tenants</Link>}
      />
      <PageBody className="max-w-5xl">
      <Card title="1. Brand assets" subtitle="Uploaded files are checked and sanitised on the server. SVGs with scripts or external links are rejected.">
        <p className="mb-4 text-body-sm text-on-surface-variant">
          {requiredDone} of {requiredSlots.length} required images uploaded · {uploadedCount} of {ASSETS.length} in total. Empty slots show the platform default.
        </p>
        {ASSET_GROUPS.map((g) => (
        <div key={g.id} className="mb-5 last:mb-0">
        <h3 className="mb-2 text-label-md font-semibold uppercase tracking-wide text-on-surface-variant">{g.title}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ASSETS.filter((a) => a.group === g.id).map((a) => {
            const src = saved.assets[a.slot];
            const meta = saved.asset_meta[a.slot];
            const busy = busySlot === a.slot;
            const dark = DARK_PREVIEW.has(a.slot);
            return (
              <div key={a.slot} className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
                <div className={`flex h-24 items-center justify-center rounded-md ${dark ? 'bg-inverse-surface' : 'bg-surface-container-low'}`}>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api${src}`} alt={`${a.label} preview`} className="max-h-20 max-w-full object-contain" />
                  ) : (
                    <span className={`text-label-sm ${dark ? 'text-inverse-on-surface' : 'text-outline'}`}>Platform default</span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-label-md font-semibold text-on-surface">
                      {a.label} <span className={`ml-1 text-label-sm font-normal ${a.need === 'required' ? 'text-primary' : 'text-outline'}`}>{NEED_LABEL[a.need]}</span>
                    </p>
                    <p className="text-label-sm text-outline">
                      {meta ? `${meta.content_type.replace('image/', '').toUpperCase()} · ${Math.max(1, Math.round(meta.bytes / 1024))} KB` : a.hint}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <input
                      ref={(el) => { fileInputs.current[a.slot] = el; }}
                      type="file"
                      accept={a.accept}
                      className="sr-only"
                      aria-label={`Upload ${a.label}`}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload(a.slot, f);
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => fileInputs.current[a.slot]?.click()}
                      className="min-h-[2.75rem] rounded-lg border border-outline-variant px-2.5 py-1 text-label-md sm:min-h-0 font-semibold text-primary hover:bg-surface-container-low disabled:opacity-60"
                    >
                      {busy ? 'Working…' : src ? 'Replace' : 'Upload'}
                    </button>
                    {src && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeAsset(a.slot)}
                        className="min-h-[2.75rem] rounded-lg px-2 py-1 text-label-md text-error sm:min-h-0 hover:bg-error-container disabled:opacity-60"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
        ))}
      </Card>

      <Card title="2. Product names" subtitle="Shown in the sidebar, browser tab, home screen and product switcher. Blank fields use the platform default.">
        <label className="mb-4 flex max-w-sm flex-col gap-1">
          <span className="text-label-md font-semibold text-on-surface">Brand name</span>
          <input
            value={names['brand']?.['name'] ?? ''}
            placeholder="Your organisation name"
            onChange={(e) => setName('brand', 'name', e.target.value)}
            className={inputCls}
          />
          {nameErrors['brand.name'] && <span className="text-label-sm text-error">{nameErrors['brand.name']}</span>}
        </label>
        <div className="flex flex-col gap-4">
          {PRODUCTS.map((p) => (
            <fieldset key={p.key} className="rounded-lg border border-outline-variant p-3">
              <legend className="px-1 text-label-md font-semibold text-on-surface">{p.label}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {NAME_FIELDS.map((f) => (
                  <label key={f.field} className="flex flex-col gap-1">
                    <span className="text-label-sm text-on-surface-variant">{f.label} <span className="text-outline">· {f.hint}</span></span>
                    <input
                      value={names[p.key]?.[f.field] ?? ''}
                      maxLength={f.max + 8}
                      onChange={(e) => setName(p.key, f.field, e.target.value)}
                      className={inputCls}
                    />
                    {nameErrors[`${p.key}.${f.field}`] && (
                      <span className="text-label-sm text-error">{nameErrors[`${p.key}.${f.field}`]}</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Card>

      <Card
        title="3. Colours & font"
        subtitle="The tenant's company theme. Lock it to stop the tenant admin — and users' personal colour/font choices — from changing it."
        aside={
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface-container px-3 py-2">
            <input type="checkbox" checked={!locked} onChange={(e) => setLocked(!e.target.checked)} className="h-4 w-4 accent-primary" />
            <span className="text-label-md text-on-surface">Allow tenant admin changes</span>
          </label>
        }
      >
        <ThemePicker value={theme} onChange={setTheme} showMode modeLabel="Default mode" modeHint="Users always keep their own light/dark choice, even when locked." disabled={saving} />
      </Card>

      <Card title="4. Login link" subtitle="Users who open this link see the tenant's branding on the sign-in page. Rotate it if it leaks — the old link then shows the platform default.">
        {loginLink ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input readOnly value={loginLink} aria-label="Login link" className={`${inputCls} font-mono`} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={copyLink} className="h-11 shrink-0 sm:h-9 rounded-lg border border-outline-variant px-3 text-label-md font-semibold text-primary hover:bg-surface-container-low">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => setConfirmRotate(true)} className="h-11 shrink-0 sm:h-9 rounded-lg border border-error px-3 text-label-md font-semibold text-error hover:bg-error-container">
              Rotate link
            </button>
          </div>
        ) : (
          <p className="text-body-sm text-outline">The link is created when branding is first saved for this tenant.</p>
        )}
      </Card>

      <Card
        title="5. Terms"
        subtitle="Rename everyday words in menus and screens for this tenant. Reports, exports, API fields and permissions are unaffected."
        aside={
          Object.keys(cleanRecord(terms)).length > 0 ? (
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
                        disabled={saving}
                        aria-invalid={Boolean(termErrors[key])}
                        onChange={(e) => setTerms((t) => ({ ...t, [key]: e.target.value }))}
                        className={inputCls}
                      />
                      {termErrors[key] && <span className="text-label-sm text-error">{termErrors[key]}</span>}
                    </label>
                  );
                })}
                <div className="col-span-2 flex justify-end md:col-span-1 md:w-16 md:pt-1.5">
                  {custom ? (
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
                    <span className="text-label-sm text-outline">Default</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        title="6. Menu labels & icons"
        subtitle="Rename menu items or pick a different icon for this tenant. Menu order, pages and who can open them do not change."
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
                          disabled={saving}
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
                          disabled={saving}
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
                        {custom && (
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
      </Card>

      <Card
        title="7. Regional settings"
        subtitle="How dates, times, numbers and money are shown to everyone in this tenant. Stored data does not change; a branch has its own time zone that still decides its working day."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            { key: 'locale', label: 'Language & region', options: LOCALE_IDS.map((v) => ({ v, t: LOCALE_LABEL[v] ?? v })) },
            { key: 'date_format', label: 'Date format', options: DATE_FORMAT_IDS.map((v) => ({ v, t: v })) },
            { key: 'time_format', label: 'Time format', options: TIME_FORMAT_IDS.map((v) => ({ v, t: v === '12h' ? '12-hour (9:30 am)' : '24-hour (09:30)' })) },
            { key: 'timezone', label: 'Default time zone', options: zones.map((v) => ({ v, t: v })) },
            { key: 'week_start', label: 'Week starts on', options: WEEK_START_IDS.map((v) => ({ v, t: WEEK_LABEL[v] ?? v })) },
            { key: 'currency', label: 'Currency', options: CURRENCY_IDS.map((v) => ({ v, t: v })) },
            { key: 'currency_display', label: 'Currency shown as', options: [{ v: 'symbol', t: 'Symbol (₹)' }, { v: 'code', t: 'Code (INR)' }] },
            { key: 'number_grouping', label: 'Number grouping', options: NUMBER_GROUPING_IDS.map((v) => ({ v, t: GROUPING_LABEL[v] ?? v })) },
            { key: 'fiscal_year_start', label: 'Financial year starts', options: MONTHS.map((t, i) => ({ v: String(i + 1), t })) },
            { key: 'phone_country_code', label: 'Default phone code', options: PHONE_COUNTRY_CODES.map((v) => ({ v, t: v })) },
          ] as const).map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-label-md font-semibold text-on-surface">{f.label}</span>
              <select
                className={inputCls}
                disabled={saving}
                value={String(localeCfg[f.key] ?? '')}
                onChange={(e) =>
                  setLocaleCfg((c) => ({ ...c, [f.key]: f.key === 'fiscal_year_start' ? Number(e.target.value) : e.target.value }))
                }
              >
                {f.options.map((o) => (
                  <option key={o.v} value={o.v}>{o.t}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm sm:grid-cols-4">
          <div><dt className="text-label-sm text-outline">Date</dt><dd className="font-semibold text-on-surface">{previewFormatters.formatDate('2026-07-05')}</dd></div>
          <div><dt className="text-label-sm text-outline">Time</dt><dd className="font-semibold text-on-surface">{previewFormatters.formatTime('2026-07-05T04:00:00Z')}</dd></div>
          <div><dt className="text-label-sm text-outline">Amount</dt><dd className="font-semibold text-on-surface">{previewFormatters.formatMoney(1234567.5)}</dd></div>
          <div><dt className="text-label-sm text-outline">Financial year</dt><dd className="font-semibold text-on-surface">{previewFormatters.fiscalYearLabel('2026-07-05')}</dd></div>
        </dl>
      </Card>

      <div aria-hidden className="h-16" />
      </PageBody>

      {(dirty || notice) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant bg-surface-container-lowest/95 px-4 py-3 shadow-overlay backdrop-blur lg:left-auto lg:right-6 lg:bottom-6 lg:w-auto lg:rounded-xl lg:border">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {notice && (
              <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`text-body-sm ${notice.kind === 'error' ? 'text-error' : 'text-on-surface-variant'} sm:mr-auto lg:mr-4 lg:max-w-md`}>
                {notice.text}
              </p>
            )}
            {dirty && (
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => adopt(saved)} disabled={saving} className="min-h-[2.75rem] rounded-lg px-3 py-2 text-label-md text-on-surface-variant hover:bg-surface-container disabled:opacity-50 sm:min-h-0">
                  Discard
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || invalid}
                  aria-busy={saving}
                  className="min-h-[2.75rem] rounded-lg bg-primary px-4 py-2 text-label-md font-semibold text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        locked={rotating}
        title="Rotate login link?"
        maxWidth="max-w-md"
        footer={
          <div className="flex w-full justify-end gap-2">
            <button type="button" onClick={() => setConfirmRotate(false)} disabled={rotating} className="rounded-lg px-3 py-2 text-label-md text-on-surface-variant hover:bg-surface-container">
              Cancel
            </button>
            <button type="button" onClick={rotate} disabled={rotating} aria-busy={rotating} className="rounded-lg bg-error px-4 py-2 text-label-md font-semibold text-on-error hover:opacity-90 disabled:opacity-60">
              {rotating ? 'Rotating…' : 'Rotate link'}
            </button>
          </div>
        }
      >
        <p className="text-body-md text-on-surface-variant">
          The current link stops showing {saved.tenant_name}&rsquo;s branding immediately. Share the new link with the tenant admin. Sign-in itself is not affected.
        </p>
      </Modal>
    </>
  );
}
