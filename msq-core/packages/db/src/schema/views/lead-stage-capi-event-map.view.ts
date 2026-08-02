import { uuid, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { extSchema } from '../pg-schemas';

// security_invoker view over the tenant-scoped base table — RLS applies to the
// querying role, so a caller only ever sees its own tenant's wiring.
export const vwLeadStageCapiEventMap = extSchema.view('vw_lead_stage_capi_event_map', {
  id:               uuid('id').notNull(),
  tenantId:         uuid('tenant_id'),
  stageId:          uuid('stage_id').notNull(),
  stageCode:        text('stage_code').notNull(),
  stageLabel:       text('stage_label').notNull(),
  capiEventTypeId:  integer('capi_event_type_id').notNull(),
  capiEventCode:    text('capi_event_code').notNull(),
  capiEventLabel:   text('capi_event_label').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();
