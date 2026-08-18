import type { FastifyInstance } from 'fastify';
import { orgTypesRouter } from './org-types/org-types.router.js';
import { tenantDomainsRouter } from './tenant-domains/tenant-domains.router.js';
import { tenantPlanTypesRouter } from './tenant-plan-types/tenant-plan-types.router.js';
import { userRolesRouter } from './user-roles/user-roles.router.js';
import { tenantsRouter } from './tenants/tenants.router.js';
import { organizationsRouter } from './organizations/organizations.router.js';
import { capabilitiesRouter } from './capabilities/capabilities.router.js';
import { departmentsRouter } from './departments/departments.router.js';
import { geoRouter } from './geo/geo.router.js';
import { capiEventTypesRouter } from './capi-event-types/capi-event-types.router.js';
import { tenantModulesRouter } from './tenant-modules/tenant-modules.router.js';
import { catalogDriftRouter } from './catalog-drift/catalog-drift.router.js';

// N-6 DONE: every product-schema lookup/role admin module has moved to its
// owning product service so the writes execute in the schema-owning service
// under tenant RLS — admin-service (shared) no longer reaches lms/hr/task.*.
//   Half A → lms.roles (leads); hr.{leave_types,employment_types,
//            attendance_statuses,roles} (hr); task.{task_statuses,
//            task_priorities,roles} (tasks).
//   Half B → the 7 lms/marketing marketing lookups (lead-stage,
//            lead-stage-outcome, interaction-types, follow-up-statuses,
//            lead-sources, marketing-platforms, campaign-statuses) → leads.
// admin-service now owns ONLY the shared iam/entity lookups below.

export async function v1Router(app: FastifyInstance): Promise<void> {
  await app.register(orgTypesRouter);
  await app.register(tenantDomainsRouter);
  await app.register(tenantPlanTypesRouter);
  await app.register(userRolesRouter);
  await app.register(tenantsRouter);
  await app.register(organizationsRouter);
  await app.register(capabilitiesRouter);
  await app.register(departmentsRouter);
  // geo.* lives in the shared `geo` schema alongside entity/iam, so it stays
  // here rather than moving to a product service under the N-6 split.
  await app.register(geoRouter);
  // ext.* is the Meta Conversion API integration, also a shared schema.
  await app.register(capiEventTypesRouter);
  await app.register(tenantModulesRouter);
  await app.register(catalogDriftRouter);
}
