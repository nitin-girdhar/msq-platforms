import * as repo from './tenant-modules.repository.js';
import { MODULE_KEYS } from './tenant-modules.schema.js';
import type { PutTenantModulesInput } from './tenant-modules.schema.js';

export async function list(tenantId: string) {
  const rows = await repo.list(tenantId);
  const active = new Set(rows.filter((r) => r.isActive).map((r) => r.module));
  // Always report all four keys, active or not — a module with no row at all
  // (never provisioned) reads identically to one explicitly disabled, which is
  // what the checkbox panel needs: every checkbox renders regardless of
  // whether entity.provision_tenant() ever wrote a row for it.
  return MODULE_KEYS.map((module) => ({ module, is_active: active.has(module) }));
}

// Disabling a module hides its nav via require-module.middleware.ts but
// intentionally leaves every row that module ever wrote untouched — re-enabling
// it later picks the data back up exactly where it was left. There is no
// cascade here to warn about at the data layer; the confirmation belongs to
// the UI, which is not this function's job.
export async function put(tenantId: string, data: PutTenantModulesInput) {
  const nextActive = new Set(data.modules);
  await Promise.all(MODULE_KEYS.map((module) => repo.setActive(tenantId, module, nextActive.has(module))));
  return list(tenantId);
}
