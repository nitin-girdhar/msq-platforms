import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import type {
  BrandAssetSlot,
  BrandAssetUploadInput,
  SaBrandingUpdateInput,
  TenantBrandingUpdateInput,
  UserThemeUpdateInput,
} from '@platform/validation';
import { ForbiddenError, NotFoundError } from '../../../lib/errors.js';
import * as service from './branding.service.js';
import type { Actor } from './branding.service.js';

// Identity and tenant ALWAYS come from the gateway-verified session
// (request.auth) — never from a body, query or param.
function actorOf(request: FastifyRequest): Actor {
  const { org_id, user_id, role, role_name, tenant_id } = request.auth;
  return { ctx: { org_id, user_id, role, tenant_id }, tenant_id, role_name, org_id, user_id };
}

function requireSuperAdmin(request: FastifyRequest): void {
  if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
}

// Platform default answered for an unknown/rotated key — same shape as a hit,
// so the login page renders either way and a probe cannot tell them apart.
const PLATFORM_DEFAULT = { theme: null, brand_name: null, product_labels: [], assets: {} };

export class BrandingController {
  // ── /me ──
  getMine = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getMyBranding(actorOf(request));
    return reply.header('Cache-Control', 'private, no-store').send({ success: true, data });
  };

  updateMyTheme = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.updateMyTheme(actorOf(request), request.body as UserThemeUpdateInput);
    return reply.send({ success: true, data });
  };

  clearMyTheme = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.clearMyTheme(actorOf(request));
    return reply.send({ success: true, data });
  };

  // ── tenant admin ──
  getTenant = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getTenantBranding(actorOf(request));
    return reply.send({ success: true, data });
  };

  updateTenant = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.updateTenantBranding(actorOf(request), request.body as TenantBrandingUpdateInput);
    return reply.send({ success: true, data });
  };

  // ── super admin ──
  saGet = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const { id } = request.params as { id: string };
    return reply.send({ success: true, data: await service.saGetBranding(id) });
  };

  saUpdate = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const { id } = request.params as { id: string };
    const data = await service.saUpdateBranding(id, actorOf(request), request.body as SaBrandingUpdateInput);
    return reply.send({ success: true, data });
  };

  saUploadAsset = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const { id, slot } = request.params as { id: string; slot: BrandAssetSlot };
    const { data } = request.body as BrandAssetUploadInput;
    return reply.status(201).send({ success: true, data: await service.saUploadAsset(id, actorOf(request), slot, data) });
  };

  saDeleteAsset = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const { id, slot } = request.params as { id: string; slot: BrandAssetSlot };
    return reply.send({ success: true, data: await service.saDeleteAsset(id, actorOf(request), slot) });
  };

  saRotateKey = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const { id } = request.params as { id: string };
    return reply.send({ success: true, data: await service.saRotateKey(id, actorOf(request)) });
  };

  // ── public (pre-login; gateway-secret only) ──
  getPublic = async (request: FastifyRequest, reply: FastifyReply) => {
    const { key } = request.params as { key: string };
    const data = (await service.getPublicBranding(key)) ?? PLATFORM_DEFAULT;
    return reply.header('Cache-Control', 'public, max-age=300').send({ success: true, data });
  };

  getPublicAsset = async (request: FastifyRequest, reply: FastifyReply) => {
    const { key, slot } = request.params as { key: string; slot: string };
    const asset = await service.getPublicAsset(key, slot);
    if (!asset) throw new NotFoundError('No such asset');
    const etag = `"${Buffer.from(asset.key).toString('base64url')}"`;
    reply
      .header('ETag', etag)
      // The URL carries ?v=<updated_at>, so a replaced asset is a new URL.
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      // Belt and braces for SVG (already sanitised on upload): nothing in the
      // image may run, load or frame anything.
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    if (request.headers['if-none-match'] === etag) return reply.status(304).send();
    return reply.header('Content-Type', asset.content_type).send(asset.bytes);
  };
}
