import { uuid, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { extSchema } from '../pg-schemas';

export const vwLeadStageCapiEventMap = extSchema.view('vw_lead_stage_capi_event_map', {
  id:               uuid('id').notNull(),
  stageId:          uuid('stage_id').notNull(),
  stageCode:        text('stage_code').notNull(),
  stageLabel:       text('stage_label').notNull(),
  capiEventTypeId:  integer('capi_event_type_id').notNull(),
  capiEventCode:    text('capi_event_code').notNull(),
  capiEventLabel:   text('capi_event_label').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();
