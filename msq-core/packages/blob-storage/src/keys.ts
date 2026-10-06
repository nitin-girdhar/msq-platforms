// ─────────────────────────────────────────────────────────────────────────────
// Blob key hierarchy — the ONE place storage keys are built and checked.
//
//   <tenant_id>/branding/<slot>/<epochMs>.<ext>
//   <tenant_id>/<branch_id>/<employee_id>/avatar/<epochMs>.<ext>
//   <tenant_id>/<branch_id>/<employee_id>/punches/<YYYY>/<MM>/<YYYYMMDD>_<chkin|chkout>_<n>.<ext>
//   <tenant_id>/<branch_id>/<employee_id>/documents/<docId>.<ext>
//   <tenant_id>/<branch_id>/<employee_id>/leave/<fileId>.<ext>
//   <tenant_id>/exports/<YYYYMMDD>/<jobId>.<ext>
//   <tenant_id>/imports/<YYYYMMDD>/<jobId>.<ext>
//   _platform/branding/<slot>.<ext>                       (platform defaults, no tenant)
//
// branch_id = entity.organizations.id, employee_id = iam.users.id.
//
// Rules: every id segment is a lower-case UUID and every other segment matches a
// strict whitelist, so a key can never carry a path escape or another tenant's id.
// The database column that stores a key stays the source of truth — never re-derive
// a path from ids (a branch transfer must not orphan an existing file).
//
// Keys written before this layout (`avatar/…`, `punch/…`, `brand/…`, `documents/…`,
// `leave/…`) are "legacy". They carry no tenant segment, so for them
// `assertKeyInTenant` can only defer to the row-level security on the row that holds
// the key; `brand/<tenant>/…` is the one legacy shape it can still verify.
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLOT_RE = /^[a-z][a-z0-9_]{0,31}$/;
const EXT_RE = /^[a-z0-9]{1,5}$/;
const YMD_RE = /^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const EPOCH_RE = /^\d{10,16}$/;

export class BlobKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlobKeyError';
  }
}

function uuid(label: string, v: string): string {
  if (!UUID_RE.test(v)) throw new BlobKeyError(`Invalid ${label} for storage key`);
  return v;
}
function ext(v: string): string {
  const e = v.toLowerCase();
  if (!EXT_RE.test(e)) throw new BlobKeyError('Invalid file extension for storage key');
  return e;
}
function slot(v: string): string {
  if (!SLOT_RE.test(v)) throw new BlobKeyError('Invalid slot for storage key');
  return v;
}
function epoch(v: number): string {
  const s = String(Math.trunc(v));
  if (!EPOCH_RE.test(s)) throw new BlobKeyError('Invalid timestamp for storage key');
  return s;
}
function ymd(v: string): RegExpExecArray {
  const m = YMD_RE.exec(v);
  if (!m) throw new BlobKeyError('Invalid date (YYYYMMDD) for storage key');
  return m;
}

/** `<tenant>/<branch>/<employee>` — the per-person folder. */
function person(tenantId: string, branchId: string, employeeId: string): string {
  return `${uuid('tenant id', tenantId)}/${uuid('branch id', branchId)}/${uuid('employee id', employeeId)}`;
}

export const blobKeys = {
  /** Tenant brand image for a slot. Immutable: a replacement gets a new timestamp. */
  brand: (tenantId: string, brandSlot: string, extension: string, at: number = Date.now()): string =>
    `${uuid('tenant id', tenantId)}/branding/${slot(brandSlot)}/${epoch(at)}.${ext(extension)}`,

  /** Platform default for a brand slot (served when a tenant has not uploaded one). */
  platformBrand: (brandSlot: string, extension: string): string =>
    `_platform/branding/${slot(brandSlot)}.${ext(extension)}`,

  /** Profile photo; the newest key (DB pointer) is active. Also the face-enrolment reference. */
  avatar: (tenantId: string, branchId: string, employeeId: string, extension: string, at: number = Date.now()): string =>
    `${person(tenantId, branchId, employeeId)}/avatar/${epoch(at)}.${ext(extension)}`,

  /**
   * Check-in/out selfie. `date` is YYYYMMDD in the org's timezone. `n` is the n-th
   * punch of that kind that day (split shifts). The date stays the LEADING part of
   * the file name so retention can age files out from the name alone.
   */
  punch: (
    tenantId: string,
    branchId: string,
    employeeId: string,
    p: { date: string; kind: 'chkin' | 'chkout'; n: number; ext: string },
  ): string => {
    const m = ymd(p.date);
    if (!Number.isInteger(p.n) || p.n < 1 || p.n > 99) throw new BlobKeyError('Invalid punch sequence for storage key');
    return `${person(tenantId, branchId, employeeId)}/punches/${m[1]}/${m[2]}/${p.date}_${p.kind}_${p.n}.${ext(p.ext)}`;
  },

  /** HR dossier file. */
  document: (tenantId: string, branchId: string, employeeId: string, docId: string, extension: string): string =>
    `${person(tenantId, branchId, employeeId)}/documents/${uuid('document id', docId)}.${ext(extension)}`,

  /** Leave attachment. */
  leave: (tenantId: string, branchId: string, employeeId: string, fileId: string, extension: string): string =>
    `${person(tenantId, branchId, employeeId)}/leave/${uuid('file id', fileId)}.${ext(extension)}`,

  /** Generated report/export (short TTL). */
  export: (tenantId: string, date: string, jobId: string, extension: string): string => {
    ymd(date);
    return `${uuid('tenant id', tenantId)}/exports/${date}/${uuid('job id', jobId)}.${ext(extension)}`;
  },

  /** Bulk-upload staging (short TTL). */
  import: (tenantId: string, date: string, jobId: string, extension: string): string => {
    ymd(date);
    return `${uuid('tenant id', tenantId)}/imports/${date}/${uuid('job id', jobId)}.${ext(extension)}`;
  },
} as const;

const LEGACY_PREFIXES = ['avatar/', 'punch/', 'brand/', 'documents/', 'leave/'] as const;

/** True for a key written before the tenant-first layout. */
export function isLegacyKey(key: string): boolean {
  return LEGACY_PREFIXES.some((p) => key.startsWith(p));
}

/** The tenant a key belongs to, or null for platform / legacy / unrecognised keys. */
export function tenantOfKey(key: string): string | null {
  const first = key.split('/', 1)[0] ?? '';
  return UUID_RE.test(first) ? first : null;
}

export interface KeyGuardOptions {
  /**
   * Accept legacy (tenant-less) keys. They cannot be tied to a tenant from the key
   * alone, so the caller MUST already have loaded the key from a row it read under
   * row-level security. Turn off once the layout migration has run everywhere.
   */
  allowLegacy?: boolean;
  /** Accept `_platform/…` default files (public brand defaults only). */
  allowPlatform?: boolean;
}

/**
 * Defence in depth for every authenticated read/serve/delete of a stored key:
 * the key must live under the caller's own tenant. Throws BlobKeyError otherwise.
 * `tenantId` MUST come from the verified session, never from the request.
 */
export function assertKeyInTenant(key: string, tenantId: string, opts: KeyGuardOptions = {}): void {
  if (!UUID_RE.test(tenantId)) throw new BlobKeyError('Invalid tenant id');
  if (key.startsWith('_platform/')) {
    if (opts.allowPlatform) return;
    throw new BlobKeyError('Storage key is outside the tenant folder');
  }
  if (isLegacyKey(key)) {
    if (!opts.allowLegacy) throw new BlobKeyError('Legacy storage key is no longer accepted');
    // `brand/<tenant>/…` is the only legacy shape that names its tenant.
    if (key.startsWith('brand/')) {
      const owner = key.split('/', 2)[1] ?? '';
      if (owner !== tenantId) throw new BlobKeyError('Storage key belongs to another tenant');
    }
    return;
  }
  if (tenantOfKey(key) !== tenantId) throw new BlobKeyError('Storage key belongs to another tenant');
}
