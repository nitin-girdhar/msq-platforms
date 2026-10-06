// Single blob-store handle for identity-service, plus the tenant guard every
// authenticated read/delete of a stored key must pass (see @platform/blob-storage keys.ts).
import { BlobKeyError, assertKeyInTenant, createBlobStorage, type BlobStorage } from '@platform/blob-storage';
import { config } from '../config/index.js';
import { ForbiddenError } from './errors.js';

let store: BlobStorage | null = null;

export function blobStore(): BlobStorage {
  if (!store) store = createBlobStorage({ driver: config.blobStorageDriver, dir: config.blobStorageDir });
  return store;
}

/**
 * Throws ForbiddenError unless `key` lives under `tenantId`. `tenantId` must come
 * from the verified session / the row the key was loaded from under RLS — never
 * from the request. Legacy tenant-less keys pass only while BLOB_ALLOW_LEGACY_KEYS
 * is on (their row-level security already scoped the lookup).
 */
export function assertOwnKey(tenantId: string, key: string, opts: { allowPlatform?: boolean } = {}): void {
  try {
    assertKeyInTenant(key, tenantId, { allowLegacy: config.blobAllowLegacyKeys, allowPlatform: opts.allowPlatform ?? false });
  } catch (err) {
    if (err instanceof BlobKeyError) throw new ForbiddenError('Forbidden');
    throw err;
  }
}
