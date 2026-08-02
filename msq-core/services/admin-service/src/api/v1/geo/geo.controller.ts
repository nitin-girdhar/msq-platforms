import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { BadRequestError, ForbiddenError } from '../../../lib/errors.js';
import * as service from './geo.service.js';
import type {
  CreateCountryInput,
  UpdateCountryInput,
  CreateStateInput,
  UpdateStateInput,
  CreateCityInput,
  UpdateCityInput,
} from './geo.schema.js';

// geo.* is tenant-owned (db_scripts/02_tables_core.sql), so every route here
// needs the tenant the admin has selected. Required rather than defaulted:
// without it a list would return every tenant's geography flattened together,
// and every tenant legitimately has its own row called "Gurgaon".
function requireTenantId(request: FastifyRequest): string {
  const { tenant_id: tenantId } = request.query as { tenant_id?: string };
  if (!tenantId) throw new BadRequestError('tenant_id is required.');
  return tenantId;
}

function requireSuperAdmin(request: FastifyRequest): void {
  if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
}

export class GeoController {
  // ── Countries ─────────────────────────────────────────────────────────────

  listCountries = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const data = await service.listCountries(requireTenantId(request));
    return reply.send({ success: true, data });
  };

  createCountry = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const tenantId = requireTenantId(request);
    const data = await service.createCountry(tenantId, request.body as CreateCountryInput);
    return reply.status(201).send({ success: true, data });
  };

  updateCountry = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const tenantId = requireTenantId(request);
    const { id } = request.params as { id: string };
    const data = await service.updateCountry(id, tenantId, request.body as UpdateCountryInput);
    return reply.send({ success: true, data });
  };

  // ── States ────────────────────────────────────────────────────────────────

  listStates = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const data = await service.listStates(requireTenantId(request));
    return reply.send({ success: true, data });
  };

  createState = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const tenantId = requireTenantId(request);
    const data = await service.createState(tenantId, request.body as CreateStateInput);
    return reply.status(201).send({ success: true, data });
  };

  updateState = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const tenantId = requireTenantId(request);
    const { id } = request.params as { id: string };
    const data = await service.updateState(id, tenantId, request.body as UpdateStateInput);
    return reply.send({ success: true, data });
  };

  // ── Cities ────────────────────────────────────────────────────────────────

  listCities = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const data = await service.listCities(requireTenantId(request));
    return reply.send({ success: true, data });
  };

  createCity = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const tenantId = requireTenantId(request);
    const data = await service.createCity(tenantId, request.body as CreateCityInput);
    return reply.status(201).send({ success: true, data });
  };

  updateCity = async (request: FastifyRequest, reply: FastifyReply) => {
    requireSuperAdmin(request);
    const tenantId = requireTenantId(request);
    const { id } = request.params as { id: string };
    const data = await service.updateCity(id, tenantId, request.body as UpdateCityInput);
    return reply.send({ success: true, data });
  };
}
