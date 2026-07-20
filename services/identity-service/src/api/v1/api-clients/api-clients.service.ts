import type { RoleTxContext } from '@platform/db';
import { generateApiKey, hashApiKey } from '@platform/db';
import type { CreateApiClientInput, UpdateApiClientInput } from '@platform/validation';
import { logActivity } from '@platform/audit-log';
import { config } from '../../../config/index.js';
import { BadRequestError, NotFoundError } from '../../../lib/errors.js';
import * as repo from './api-clients.repository.js';

function pepper(): string {
  if (!config.publicApiKeyPepper) {
    throw new BadRequestError('Public API is not configured (missing PUBLIC_API_KEY_PEPPER)');
  }
  return config.publicApiKeyPepper;
}

export interface ApiClientBranchScope {
  org_ids: string[];
  scope_all_orgs: boolean;
}

// For org_admin, the branch scope is always their own org — never the
// client-supplied org_ids/scope_all_orgs. For tenant_admin/super_admin, the
// requested org_ids are validated against the tenant before use.
async function resolveBranchScope(
  ctx: RoleTxContext,
  isOrgAdmin: boolean,
  requested: { org_ids?: string[] | undefined; scope_all_orgs?: boolean | undefined },
): Promise<ApiClientBranchScope> {
  if (isOrgAdmin) {
    return { org_ids: [ctx.org_id], scope_all_orgs: false };
  }
  const org_ids = requested.org_ids ?? [];
  const scope_all_orgs = requested.scope_all_orgs ?? false;
  if (!scope_all_orgs && org_ids.length > 0) {
    const valid = await repo.orgsBelongToTenant(org_ids, ctx.tenant_id);
    if (!valid) throw new BadRequestError('One or more org_ids do not belong to this tenant');
  }
  return { org_ids: scope_all_orgs ? [] : org_ids, scope_all_orgs };
}

export async function createApiClient(
  ctx: RoleTxContext,
  data: CreateApiClientInput,
  isOrgAdmin: boolean,
) {
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw new BadRequestError('expires_at must be in the future');
  }

  const scope = await resolveBranchScope(ctx, isOrgAdmin, data);

  const { raw, prefix } = generateApiKey('live');
  const key_hash = hashApiKey(raw, pepper());

  const created = await repo.insertApiClient(ctx, {
    tenant_id: ctx.tenant_id,
    org_ids: scope.org_ids,
    scope_all_orgs: scope.scope_all_orgs,
    name: data.name,
    key_prefix: prefix,
    key_hash,
    scopes: data.scopes,
    rate_limit_per_min: data.rate_limit_per_min ?? 60,
    expires_at: data.expires_at ?? null,
    created_by: ctx.user_id,
  });

  await logActivity({
    action_type: 'api_client_created',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { id: created['id'], name: data.name, scopes: data.scopes },
  });

  // The raw key is returned exactly once and never stored.
  return { ...created, api_key: raw };
}

export async function listApiClients(ctx: RoleTxContext) {
  return repo.listApiClients(ctx);
}

export async function updateApiClient(
  ctx: RoleTxContext,
  id: string,
  data: UpdateApiClientInput,
  isOrgAdmin: boolean,
) {
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw new BadRequestError('expires_at must be in the future');
  }

  let scope: ApiClientBranchScope | undefined;
  if (data.org_ids !== undefined || data.scope_all_orgs !== undefined) {
    scope = await resolveBranchScope(ctx, isOrgAdmin, data);
  }

  const patch: repo.UpdateApiClientData = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.scopes !== undefined) patch.scopes = data.scopes;
  if (data.rate_limit_per_min !== undefined) patch.rate_limit_per_min = data.rate_limit_per_min;
  if (data.expires_at !== undefined) patch.expires_at = data.expires_at;
  if (scope) {
    patch.org_ids = scope.org_ids;
    patch.scope_all_orgs = scope.scope_all_orgs;
  }

  const updated = await repo.updateApiClient(ctx, id, patch);
  if (!updated) throw new NotFoundError('API client not found');

  await logActivity({
    action_type: 'api_client_updated',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { id },
  });

  return updated;
}

export async function revokeApiClient(ctx: RoleTxContext, id: string) {
  const revoked = await repo.revokeApiClient(ctx, id);
  if (!revoked) throw new NotFoundError('API client not found');
  await logActivity({
    action_type: 'api_client_revoked',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { id },
  });
}

export async function rotateApiClient(ctx: RoleTxContext, id: string) {
  const { raw, prefix } = generateApiKey('live');
  const key_hash = hashApiKey(raw, pepper());

  const rotated = await repo.rotateApiClient(ctx, id, { key_prefix: prefix, key_hash });
  if (!rotated) throw new NotFoundError('Active API client not found');

  await logActivity({
    action_type: 'api_client_rotated',
    performed_by: ctx.user_id,
    org_id: ctx.org_id,
    new_value: { previous_id: id, new_id: rotated['id'] },
  });

  return { ...rotated, api_key: raw };
}
