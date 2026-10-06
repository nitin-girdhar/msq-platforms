import type { BrandAssetSlot } from './types';

// The brand image slots as the upload screens (Super Admin + tenant admin) present
// them. Every size is uploaded by the tenant — the platform never resizes or
// generates one. Limits mirror SLOT_RULES in identity-service/src/lib/brand-assets.ts
// (the real gate); here they only let an obviously wrong file fail before upload.
// A slot a tenant leaves empty shows the platform default.

export type BrandAssetNeed = 'required' | 'recommended' | 'optional';
export type BrandAssetGroupId = 'logos' | 'app' | 'notify' | 'login';

export interface BrandAssetSpec {
  slot: BrandAssetSlot;
  group: BrandAssetGroupId;
  need: BrandAssetNeed;
  label: string;
  hint: string;
  accept: string;
  maxKb: number;
}

export const BRAND_ASSET_GROUPS: ReadonlyArray<{ id: BrandAssetGroupId; title: string }> = [
  { id: 'logos', title: 'Logos' },
  { id: 'app', title: 'App & browser icons' },
  { id: 'notify', title: 'Notifications & email' },
  { id: 'login', title: 'Login & splash' },
];

export const BRAND_ASSET_NEED_LABEL: Record<BrandAssetNeed, string> = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
};

const SVG_PNG_WEBP = 'image/svg+xml,image/png,image/webp';

export const BRAND_ASSET_CATALOG: ReadonlyArray<BrandAssetSpec> = [
  { slot: 'logo', group: 'logos', need: 'required', label: 'Full logo (light)', hint: 'SVG, PNG or WebP · wide, transparent · navbar & login', accept: SVG_PNG_WEBP, maxKb: 512 },
  { slot: 'logo_dark', group: 'logos', need: 'recommended', label: 'Full logo (dark)', hint: 'SVG, PNG or WebP · for dark backgrounds', accept: SVG_PNG_WEBP, maxKb: 512 },
  { slot: 'mark', group: 'logos', need: 'required', label: 'Logo mark', hint: 'Square SVG, PNG or WebP · sidebar', accept: SVG_PNG_WEBP, maxKb: 256 },
  { slot: 'favicon', group: 'app', need: 'required', label: 'Favicon', hint: 'PNG (square, ≥ 32 px), ICO or SVG · browser tab', accept: 'image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml', maxKb: 128 },
  { slot: 'app_icon', group: 'app', need: 'required', label: 'App icon', hint: 'Square PNG ≥ 512 px · home screen / install', accept: 'image/png', maxKb: 1024 },
  { slot: 'app_icon_maskable', group: 'app', need: 'optional', label: 'App icon (maskable)', hint: 'Square PNG ≥ 512 px, artwork inside the centre 80% · Android', accept: 'image/png', maxKb: 1024 },
  { slot: 'icon_192', group: 'app', need: 'optional', label: 'App icon 192', hint: 'PNG exactly 192×192 · install manifest', accept: 'image/png', maxKb: 256 },
  { slot: 'apple_touch_icon', group: 'app', need: 'optional', label: 'Apple touch icon', hint: 'PNG exactly 180×180 · iPhone / iPad home screen', accept: 'image/png', maxKb: 256 },
  { slot: 'push_icon', group: 'notify', need: 'optional', label: 'Notification icon', hint: 'Square PNG ≥ 192 px · push notifications', accept: 'image/png', maxKb: 256 },
  { slot: 'push_badge', group: 'notify', need: 'optional', label: 'Notification badge', hint: 'Square PNG ≥ 96 px, white on transparent · Android status bar', accept: 'image/png', maxKb: 64 },
  { slot: 'email_logo', group: 'notify', need: 'optional', label: 'Email logo', hint: 'PNG, 300–800 px wide · email header', accept: 'image/png', maxKb: 128 },
  { slot: 'login_hero', group: 'login', need: 'optional', label: 'Login background', hint: 'JPEG, PNG or WebP, ≥ 1200×700 · login page', accept: 'image/jpeg,image/png,image/webp', maxKb: 1024 },
  { slot: 'splash', group: 'login', need: 'optional', label: 'Splash image', hint: 'Portrait PNG, ≥ 1080×1920 · app launch', accept: 'image/png', maxKb: 1024 },
];

/** Previewed on a dark tile: these are drawn over dark surfaces. */
export const BRAND_ASSET_DARK_PREVIEW: ReadonlySet<BrandAssetSlot> = new Set<BrandAssetSlot>(['logo_dark', 'push_badge']);
