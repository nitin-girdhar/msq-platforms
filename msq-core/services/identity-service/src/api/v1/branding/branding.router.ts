import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BRAND_ASSET_SLOTS,
  brandAssetUploadSchema,
  saBrandingUpdateSchema,
  tenantBrandingUpdateSchema,
  userThemeUpdateSchema,
} from '@platform/validation';
import { authenticate, requireInternalSecret } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { BrandingController } from './branding.controller.js';

const tenantIdParams = z.object({ id: z.string().uuid() });
const assetParams = z.object({ id: z.string().uuid(), slot: z.enum(BRAND_ASSET_SLOTS) });
const publicParams = z.object({ key: z.string().uuid() });
const publicAssetParams = z.object({ key: z.string().uuid(), slot: z.enum(BRAND_ASSET_SLOTS) });

// Base64 brand assets (≤1 MB → ~1.4 MB encoded) exceed Fastify's 1 MiB default.
const ASSET_BODY_LIMIT = 3 * 1024 * 1024;

export async function brandingRouter(app: FastifyInstance) {
  const ctrl = new BrandingController();

  // Personal — any authenticated user; appearance writes need platform.appearance (service).
  app.get('/me/branding', { preHandler: [authenticate] }, ctrl.getMine);
  app.put('/me/preferences/theme', { preHandler: [authenticate, validate({ body: userThemeUpdateSchema })] }, ctrl.updateMyTheme);
  app.delete('/me/preferences/theme', { preHandler: [authenticate] }, ctrl.clearMyTheme);

  // Tenant admin — admin.branding.view / .manage (service), own tenant only (RLS).
  app.get('/tenant/branding', { preHandler: [authenticate] }, ctrl.getTenant);
  app.put('/tenant/branding', { preHandler: [authenticate, validate({ body: tenantBrandingUpdateSchema })] }, ctrl.updateTenant);

  // Super Admin — rank-gated in the controller; cross-tenant by design.
  app.get('/sa/tenants/:id/branding', { preHandler: [authenticate, validate({ params: tenantIdParams })] }, ctrl.saGet);
  app.put('/sa/tenants/:id/branding', {
    preHandler: [authenticate, validate({ params: tenantIdParams, body: saBrandingUpdateSchema })],
  }, ctrl.saUpdate);
  app.post('/sa/tenants/:id/branding/assets/:slot', {
    bodyLimit: ASSET_BODY_LIMIT,
    preHandler: [authenticate, validate({ params: assetParams, body: brandAssetUploadSchema })],
  }, ctrl.saUploadAsset);
  app.delete('/sa/tenants/:id/branding/assets/:slot', {
    preHandler: [authenticate, validate({ params: assetParams })],
  }, ctrl.saDeleteAsset);
  app.post('/sa/tenants/:id/branding/rotate-key', {
    preHandler: [authenticate, validate({ params: tenantIdParams })],
  }, ctrl.saRotateKey);

  // Public, pre-login: no user session exists. Gateway-secret only (no direct
  // browser access); the gateway rate-limits these. Display data / logo bytes.
  app.get('/public/branding/:key', {
    preHandler: [requireInternalSecret, validate({ params: publicParams })],
  }, ctrl.getPublic);
  app.get('/public/branding/:key/assets/:slot', {
    preHandler: [requireInternalSecret, validate({ params: publicAssetParams })],
  }, ctrl.getPublicAsset);
}
