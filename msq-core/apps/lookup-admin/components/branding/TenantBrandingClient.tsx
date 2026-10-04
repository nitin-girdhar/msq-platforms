'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Modal, ThemePicker } from '@platform/ui-kit';
import { DEFAULT_FONT_ID, DEFAULT_PRESET_ID, type ThemeChoice } from '@platform/ui-kit/theme';
import { BRANDABLE_NAV, BRAND_TERM_ROWS } from '@platform/ui-kit/branding';
import { saBranding, type BrandAssetSlot, type SaBrandingUpdate, type SaBrandingView } from '@/src/lib/api/client';

interface Props {
  tenantId: string;
  initial: SaBrandingView;
}

// Upload rules mirror identity-service lib/brand-assets.ts (the real gate);
// checked here only so an obviously wrong file fails before the upload.
const ASSETS: ReadonlyArray<{ slot: BrandAssetSlot; label: string; hint: string; accept: string; maxKb: number }> = [
  { slot: 'logo', label: 'Full logo (light)', hint: 'SVG or PNG · navbar & login', accept: 'image/svg+xml,image/png', maxKb: 512 },
  { slot: 'logo_dark', label: 'Full logo (dark)', hint: 'SVG or PNG · dark backgrounds', accept: 'image/svg+xml,image/png', maxKb: 512 },
  { slot: 'mark', label: 'Logo mark', hint: 'Square SVG or PNG · sidebar', accept: 'image/svg+xml,image/png', maxKb: 256 },
  { slot: 'favicon', label: 'Favicon', hint: 'PNG or ICO · browser tab', accept: 'image/png,image/x-icon,image/vnd.microsoft.icon', maxKb: 128 },
  { slot: 'app_icon', label: 'App icon', hint: 'Square PNG ≥ 512 px · home screen', accept: 'image/png', maxKb: 1024 },
];

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

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

const inputCls =
  'h-9 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-body-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none disabled:opacity-60';

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
  const dirty = themeDirty || lockDirty || namesDirty;

  const nameErrors: Record<string, string> = {};
  for (const [k, fields] of Object.entries(names)) {
    for (const [fk, v] of Object.entries(fields ?? {})) {
      const max = k === 'brand' ? 40 : (NAME_FIELDS.find((f) => f.field === fk)?.max ?? 60);
      if ((v ?? '').trim().length > max) nameErrors[`${k}.${fk}`] = `Max ${max} characters`;
      else if (MARKUP_RE.test(v ?? '')) nameErrors[`${k}.${fk}`] = 'Must not contain < > { }';
    }
  }
  const invalid = Object.keys(nameErrors).length > 0;

  const adopt = (v: SaBrandingView) => {
    setSaved(v);
    setTheme(themeOf(v));
    setLocked(v.theme_locked);
    setNames(structuredClone(v.product_names));
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

  const termsSet = BRAND_TERM_ROWS.filter((r) => saved.terms[r.singular] || saved.terms[r.plural]);
  const navSet = BRANDABLE_NAV.flatMap((g) => g.items).filter((i) => saved.nav_overrides[i.id]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-28 sm:p-6 sm:pb-28">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboard/branding" className="text-label-sm text-primary hover:underline">← All tenants</Link>
          <h1 className="mt-1 text-headline-md font-bold text-on-surface">Tenant branding</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {saved.tenant_name} · logos, product names, colours and the tenant login link.
          </p>
        </div>
      </header>

      <Card title="1. Brand assets" subtitle="Uploaded files are checked and sanitised on the server. SVGs with scripts or external links are rejected.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ASSETS.map((a) => {
            const src = saved.assets[a.slot];
            const meta = saved.asset_meta[a.slot];
            const busy = busySlot === a.slot;
            return (
              <div key={a.slot} className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
                <div className={`flex h-24 items-center justify-center rounded-md ${a.slot === 'logo_dark' ? 'bg-inverse-surface' : 'bg-surface-container-low'}`}>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api${src}`} alt={`${a.label} preview`} className="max-h-20 max-w-full object-contain" />
                  ) : (
                    <span className={`text-label-sm ${a.slot === 'logo_dark' ? 'text-inverse-on-surface' : 'text-outline'}`}>Platform default</span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-label-md font-semibold text-on-surface">{a.label}</p>
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
                      className="rounded-lg border border-outline-variant px-2.5 py-1 text-label-md font-semibold text-primary hover:bg-surface-container-low disabled:opacity-60"
                    >
                      {busy ? 'Working…' : src ? 'Replace' : 'Upload'}
                    </button>
                    {src && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeAsset(a.slot)}
                        className="rounded-lg px-2 py-1 text-label-md text-error hover:bg-error-container disabled:opacity-60"
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
      </Card>

      <Card title="2. Product names" subtitle="Shown in the sidebar, browser tab, home screen and product switcher. Blank fields use the platform default.">
        <label className="mb-4 flex max-w-sm flex-col gap-1">
          <span className="text-label-md font-semibold text-on-surface">Brand name</span>
          <input
            value={names['brand']?.['name'] ?? ''}
            placeholder="Fitclass"
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
            <button type="button" onClick={copyLink} className="h-9 shrink-0 rounded-lg border border-outline-variant px-3 text-label-md font-semibold text-primary hover:bg-surface-container-low">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => setConfirmRotate(true)} className="h-9 shrink-0 rounded-lg border border-error px-3 text-label-md font-semibold text-error hover:bg-error-container">
              Rotate link
            </button>
          </div>
        ) : (
          <p className="text-body-sm text-outline">The link is created when branding is first saved for this tenant.</p>
        )}
      </Card>

      <Card title="5. Tenant admin customisations" subtitle="Terms and menu labels the tenant admin has set (read-only here).">
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
      </Card>

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
                <button type="button" onClick={() => adopt(saved)} disabled={saving} className="rounded-lg px-3 py-2 text-label-md text-on-surface-variant hover:bg-surface-container disabled:opacity-50">
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
    </div>
  );
}
