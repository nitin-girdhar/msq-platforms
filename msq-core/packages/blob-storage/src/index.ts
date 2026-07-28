// ─────────────────────────────────────────────────────────────────────────────
// Shared blob storage — profile avatars (identity-service) and attendance
// check-in/out selfies (hr-service) live on ONE Docker-volume-backed store so
// hr-service can read an avatar that identity-service wrote (face enrollment)
// without a network hop. Env-selectable driver behind a small interface: the
// `local` driver writes to a directory; an `s3` driver can be dropped in later
// without touching call sites.
//
// Bytes are NEVER served from a public static dir — each service re-serves them
// through an authenticated route after an authority check.
//
// Keys are opaque, caller-chosen relative paths:
//   avatar/<userId>/<epochMs>.jpg        — enrolled reference photo (immutable;
//                                           newest key is the active one)
//   punch/<userId>/<YYYYMMDD>_chkin_<n>.jpg  — check-in selfie, n-th of the day
//   punch/<userId>/<YYYYMMDD>_chkout_<n>.jpg — check-out selfie, n-th of the day
// The <n> suffix exists because a split shift punches several times a day; a
// fixed <YYYYMMDD>_chkin key overwrote the earlier session's selfie. YYYYMMDD
// stays LEADING: msq-deploy/retention/retention-cleanup.sh ages selfies out by
// taking the basename up to the first underscore.
// The local driver refuses any key that escapes the base directory
// (path-traversal guard) so a stored key can be echoed back into get() safely.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface BlobStorage {
  /** Persist bytes at a caller-chosen key (created/overwritten); returns the key. */
  putAt(key: string, data: Buffer): Promise<string>;
  /** Persist bytes under `prefix` with a random filename; returns the generated key. */
  put(data: Buffer, ext: string, prefix?: string): Promise<string>;
  /** Fetch bytes by key, or null if not found. */
  get(key: string): Promise<Buffer | null>;
  /** True if a key exists. */
  exists(key: string): Promise<boolean>;
  /** Delete a key; resolves whether or not it existed (idempotent). */
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

/** Map a stored key's extension to a Content-Type for authenticated GET routes. */
export function contentTypeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/** Sniff a supported image type from magic bytes; defaults to jpg. */
export function detectImageExt(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return 'jpg';
}

class LocalBlobStorage implements BlobStorage {
  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.baseDir, key);
    const base = path.resolve(this.baseDir);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error(`Key escapes storage root: ${key}`);
    }
    return full;
  }

  async putAt(key: string, data: Buffer): Promise<string> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return key;
  }

  async put(data: Buffer, ext: string, prefix = 'blob'): Promise<string> {
    const safeExt = ext.replace(/[^a-z0-9]/gi, '') || 'bin';
    const safePrefix = prefix.replace(/[^a-z0-9/_-]/gi, '') || 'blob';
    return this.putAt(`${safePrefix}/${randomUUID()}.${safeExt}`, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

export interface BlobStorageConfig {
  /** 'local' (default). 's3' reserved for a future increment. */
  driver?: string;
  /** Base directory for the local driver. */
  dir?: string;
}

/**
 * Build a blob store from config, falling back to env:
 *   BLOB_STORAGE_DRIVER (default 'local')
 *   BLOB_STORAGE_DIR    (default '/data/blobs')
 * Both hr-service and identity-service MUST resolve to the same directory (same
 * mounted volume) so avatars written by one are readable by the other.
 */
export function createBlobStorage(cfg: BlobStorageConfig = {}): BlobStorage {
  const driver = cfg.driver ?? process.env['BLOB_STORAGE_DRIVER'] ?? 'local';
  const dir = cfg.dir ?? process.env['BLOB_STORAGE_DIR'] ?? '/data/blobs';
  switch (driver) {
    case 'local':
      return new LocalBlobStorage(dir);
    default:
      throw new Error(`Unsupported BLOB_STORAGE_DRIVER: ${driver}`);
  }
}
