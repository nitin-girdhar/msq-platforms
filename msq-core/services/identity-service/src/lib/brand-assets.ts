// Brand asset (logo / mark / favicon / app icon) validation. Pure — no I/O.
//
// Brand assets are served PUBLICLY (the login page shows them before sign-in),
// unlike profile photos, so what is accepted here is what any visitor's browser
// will render. Rules:
//   - the type is read from the bytes (magic numbers), never from a client claim;
//   - SVG is accepted only when it carries nothing executable or external
//     (no <script>, on* handlers, javascript:/data: URLs, <foreignObject>,
//     embedded documents, or off-document references). The route that serves it
//     additionally sends a locked-down Content-Security-Policy and nosniff, so a
//     pattern this misses still cannot run;
//   - each slot has its own size cap, allowed types and pixel rules (SLOT_RULES);
//     e.g. the PWA icon must be a square PNG of at least 512×512 and the Apple
//     touch icon exactly 180×180. Tenants upload every size themselves — nothing
//     is resized or generated here.
import type { BrandAssetSlot } from '@platform/validation';

export type BrandAssetType = 'image/png' | 'image/svg+xml' | 'image/webp' | 'image/x-icon' | 'image/jpeg';

// Pixel rules, checked on raster files whose header we can read (PNG, JPEG).
// SVG, ICO and WebP have no fixed pixel size to check here.
interface DimRule {
  square?: boolean;
  portrait?: boolean;
  minW?: number;
  minH?: number;
  maxW?: number;
  exact?: number; // exact width AND height (implies square)
}

interface SlotRule {
  types: readonly BrandAssetType[];
  maxBytes: number;
  dims?: DimRule;
}

const KB = 1024;
const LOGO_TYPES = ['image/png', 'image/svg+xml', 'image/webp'] as const;

// One row per slot — keep in step with BRAND_ASSET_SLOTS (@platform/validation) and
// the ASSETS list in lookup-admin's TenantBrandingClient. A slot a tenant leaves
// empty falls back to the platform default (`_platform/branding/<slot>.<ext>`).
export const SLOT_RULES: Record<BrandAssetSlot, SlotRule> = {
  logo:              { types: LOGO_TYPES, maxBytes: 512 * KB },
  logo_dark:         { types: LOGO_TYPES, maxBytes: 512 * KB },
  mark:              { types: LOGO_TYPES, maxBytes: 256 * KB },
  favicon:           { types: ['image/png', 'image/x-icon', 'image/svg+xml'], maxBytes: 128 * KB, dims: { square: true, minW: 32 } },
  app_icon:          { types: ['image/png'], maxBytes: 1024 * KB, dims: { square: true, minW: 512 } },
  app_icon_maskable: { types: ['image/png'], maxBytes: 1024 * KB, dims: { square: true, minW: 512 } },
  apple_touch_icon:  { types: ['image/png'], maxBytes: 256 * KB, dims: { exact: 180 } },
  icon_192:          { types: ['image/png'], maxBytes: 256 * KB, dims: { exact: 192 } },
  push_icon:         { types: ['image/png'], maxBytes: 256 * KB, dims: { square: true, minW: 192 } },
  push_badge:        { types: ['image/png'], maxBytes: 64 * KB, dims: { square: true, minW: 96 } },
  email_logo:        { types: ['image/png'], maxBytes: 128 * KB, dims: { minW: 300, maxW: 800 } },
  login_hero:        { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 1024 * KB, dims: { minW: 1200, minH: 700 } },
  splash:            { types: ['image/png'], maxBytes: 1024 * KB, dims: { portrait: true, minW: 1080, minH: 1920 } },
};

export const EXT_FOR_TYPE: Record<BrandAssetType, string> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/jpeg': 'jpg',
};

export class BrandAssetError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** Strip an optional data: URI prefix and decode base64. */
export function decodeAsset(data: string): Buffer {
  const comma = data.indexOf(',');
  const b64 = data.startsWith('data:') && comma !== -1 ? data.slice(comma + 1) : data;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) throw new BrandAssetError('File is empty or not valid base64', 'ASSET_EMPTY');
  return buf;
}

// Formats we recognise only to name them in the rejection message.
function sniffRejected(buf: Buffer): string | null {
  if (buf.length >= 4 && buf.toString('ascii', 0, 3) === 'GIF') return 'GIF';
  if (buf.length >= 12 && buf.toString('ascii', 4, 12) === 'ftypavif') return 'AVIF';
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'PDF';
  return null;
}

// Skips the prolog an editor may put before <svg>: XML declaration, comments,
// processing instructions and a DOCTYPE (including an internal [...] subset,
// which Illustrator emits). Anything left must start with <svg.
const SVG_PROLOG = /^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg(?:[^>[]|\[[\s\S]*?\])*>)*<svg[\s>]/i;

function sniff(buf: Buffer): BrandAssetType | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  const head = buf.subarray(0, 16 * KB).toString('utf8').replace(/^﻿/, '');
  if (SVG_PROLOG.test(head)) return 'image/svg+xml';
  return null;
}

// Anything executable or reaching outside the document. Deliberately broad:
// a brand mark has no legitimate need for any of these.
const SVG_FORBIDDEN: Array<[RegExp, string]> = [
  [/<script[\s>/]/i, 'scripts'],
  [/\son[a-z]+\s*=/i, 'event handlers'],
  [/javascript\s*:/i, 'javascript: URLs'],
  [/<foreignObject[\s>/]/i, 'embedded HTML (foreignObject)'],
  [/<(iframe|embed|object|audio|video|canvas)[\s>/]/i, 'embedded documents or media'],
  [/<!ENTITY/i, 'XML entities'],
  [/(?:xlink:)?href\s*=\s*["']\s*(?!#)/i, 'links to anything outside the image'],
  [/url\(\s*["']?\s*(?!#)/i, 'external CSS references'],
  [/@import/i, 'CSS imports'],
];

/** PNG width/height from the IHDR chunk (bytes 16–23), or null if malformed. */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** JPEG width/height from the first SOFn marker, or null if malformed. */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

function checkDims(type: BrandAssetType, buf: Buffer, d: DimRule): void {
  // Only raster formats whose header we can read; SVG/ICO/WebP pass.
  if (type !== 'image/png' && type !== 'image/jpeg') return;
  const size = type === 'image/png' ? pngSize(buf) : jpegSize(buf);
  if (!size) throw new BrandAssetError(`Could not read the ${type === 'image/png' ? 'PNG' : 'JPEG'} size`, 'ASSET_BAD_IMAGE');
  const { w, h } = size;
  if (d.exact !== undefined && (w !== d.exact || h !== d.exact)) {
    throw new BrandAssetError(`Must be exactly ${d.exact}×${d.exact} (yours is ${w}×${h})`, 'ASSET_WRONG_SIZE');
  }
  if (d.square && w !== h) throw new BrandAssetError(`Must be square (yours is ${w}×${h})`, 'ASSET_NOT_SQUARE');
  if (d.portrait && h <= w) throw new BrandAssetError(`Must be portrait, taller than wide (yours is ${w}×${h})`, 'ASSET_NOT_PORTRAIT');
  if ((d.minW && w < d.minW) || (d.minH && h < d.minH)) {
    const need = d.square || d.exact ? `${d.minW}×${d.minW}` : `${d.minW ?? 1}×${d.minH ?? 1}`;
    throw new BrandAssetError(`Must be at least ${need} (yours is ${w}×${h})`, 'ASSET_TOO_SMALL');
  }
  if (d.maxW && w > d.maxW) throw new BrandAssetError(`Must be at most ${d.maxW} px wide (yours is ${w})`, 'ASSET_TOO_WIDE');
}

/** Validate bytes for a slot; returns the sniffed type or throws BrandAssetError. */
export function validateBrandAsset(slot: BrandAssetSlot, buf: Buffer): BrandAssetType {
  const rule = SLOT_RULES[slot];
  if (buf.length > rule.maxBytes) {
    throw new BrandAssetError(`File is larger than ${Math.round(rule.maxBytes / KB)} KB`, 'ASSET_TOO_LARGE');
  }
  const type = sniff(buf);
  if (!type || !rule.types.includes(type)) {
    const allowed = rule.types.map((t) => EXT_FOR_TYPE[t].toUpperCase()).join(', ');
    const got = type ? EXT_FOR_TYPE[type].toUpperCase() : sniffRejected(buf);
    throw new BrandAssetError(
      got ? `This slot accepts ${allowed} only (you uploaded ${got})` : `This slot accepts ${allowed} only (file type not recognised)`,
      'ASSET_WRONG_TYPE',
    );
  }
  if (type === 'image/svg+xml') {
    const text = buf.toString('utf8');
    for (const [re, what] of SVG_FORBIDDEN) {
      if (re.test(text)) {
        throw new BrandAssetError(`SVG contains ${what} and was rejected`, 'ASSET_SVG_UNSAFE');
      }
    }
  }
  if (rule.dims) checkDims(type, buf, rule.dims);
  return type;
}
