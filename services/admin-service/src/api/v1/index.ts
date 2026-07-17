import type { FastifyInstance } from 'fastify';
import { orgTypesRouter } from './org-types/org-types.router.js';
import { tenantDomainsRouter } from './tenant-domains/tenant-domains.router.js';
import { tenantPlanTypesRouter } from './tenant-plan-types/tenant-plan-types.router.js';
import { userRolesRouter } from './user-roles/user-roles.router.js';
import { leadStageRouter } from './lead-stage/lead-stage.router.js';
import { leadStageOutcomeRouter } from './lead-stage-outcome/lead-stage-outcome.router.js';
import { interactionTypesRouter } from './interaction-types/interaction-types.router.js';
import { followUpStatusesRouter } from './follow-up-statuses/follow-up-statuses.router.js';
import { leadSourcesRouter } from './lead-sources/lead-sources.router.js';
import { marketingPlatformsRouter } from './marketing-platforms/marketing-platforms.router.js';
import { campaignStatusesRouter } from './campaign-statuses/campaign-statuses.router.js';
import { tenantsRouter } from './tenants/tenants.router.js';
import { organizationsRouter } from './organizations/organizations.router.js';
import { taskStatusesRouter } from './task-statuses/task-statuses.router.js';
import { taskPrioritiesRouter } from './task-priorities/task-priorities.router.js';

export async function v1Router(app: FastifyInstance): Promise<void> {
  await app.register(orgTypesRouter);
  await app.register(tenantDomainsRouter);
  await app.register(tenantPlanTypesRouter);
  await app.register(userRolesRouter);
  await app.register(leadStageRouter);
  await app.register(leadStageOutcomeRouter);
  await app.register(interactionTypesRouter);
  await app.register(followUpStatusesRouter);
  await app.register(leadSourcesRouter);
  await app.register(marketingPlatformsRouter);
  await app.register(campaignStatusesRouter);
  await app.register(tenantsRouter);
  await app.register(organizationsRouter);
  await app.register(taskStatusesRouter);
  await app.register(taskPrioritiesRouter);
}
