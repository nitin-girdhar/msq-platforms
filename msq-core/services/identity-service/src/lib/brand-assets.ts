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
//   - each slot has its own size cap and allowed types; the PWA icon must be a
//     square PNG of at least 512×512 (browsers scale it down).
import type { BrandAssetSlot } from '@platform/validation';

export type BrandAssetType = 'image/png' | 'image/svg+xml' | 'image/webp' | 'image/x-icon';

interface SlotRule {
  types: readonly BrandAssetType[];
  maxBytes: number;
  squarePngMin?: number;
}

const KB = 1024;
export const SLOT_RULES: Record<BrandAssetSlot, SlotRule> = {
  logo:      { types: ['image/png', 'image/svg+xml', 'image/webp'], maxBytes: 512 * KB },
  logo_dark: { types: ['image/png', 'image/svg+xml', 'image/webp'], maxBytes: 512 * KB },
  mark:      { types: ['image/png', 'image/svg+xml', 'image/webp'], maxBytes: 256 * KB },
  favicon:   { types: ['image/png', 'image/x-icon', 'image/svg+xml'], maxBytes: 128 * KB },
  app_icon:  { types: ['image/png'], maxBytes: 1024 * KB, squarePngMin: 512 },
};

export const EXT_FOR_TYPE: Record<BrandAssetType, string> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
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

function sniff(buf: Buffer): BrandAssetType | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  const head = buf.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
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

/** Validate bytes for a slot; returns the sniffed type or throws BrandAssetError. */
export function validateBrandAsset(slot: BrandAssetSlot, buf: Buffer): BrandAssetType {
  const rule = SLOT_RULES[slot];
  if (buf.length > rule.maxBytes) {
    throw new BrandAssetError(`File is larger than ${Math.round(rule.maxBytes / KB)} KB`, 'ASSET_TOO_LARGE');
  }
  const type = sniff(buf);
  if (!type || !rule.types.includes(type)) {
    const allowed = rule.types.map((t) => EXT_FOR_TYPE[t].toUpperCase()).join(', ');
    throw new BrandAssetError(`This slot accepts ${allowed} only`, 'ASSET_WRONG_TYPE');
  }
  if (type === 'image/svg+xml') {
    const text = buf.toString('utf8');
    for (const [re, what] of SVG_FORBIDDEN) {
      if (re.test(text)) {
        throw new BrandAssetError(`SVG contains ${what} and was rejected`, 'ASSET_SVG_UNSAFE');
      }
    }
  }
  if (rule.squarePngMin) {
    const size = pngSize(buf);
    if (!size) throw new BrandAssetError('Could not read the PNG size', 'ASSET_BAD_PNG');
    if (size.w !== size.h) throw new BrandAssetError('App icon must be square', 'ASSET_NOT_SQUARE');
    if (size.w < rule.squarePngMin) {
      throw new BrandAssetError(`App icon must be at least ${rule.squarePngMin}×${rule.squarePngMin}`, 'ASSET_TOO_SMALL');
    }
  }
  return type;
}
