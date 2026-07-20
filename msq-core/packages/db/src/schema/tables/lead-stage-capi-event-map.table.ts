import { uuid, integer, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { leadStageTable } from './lead-stage.table';
import { metaCapiEventTypesTable } from './meta-capi-event-types.table';

export const leadStageCapiEventMapTable = extSchema.table('lead_stage_capi_event_map', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  stageId:         uuid('stage_id').notNull().unique()
    .references(() => leadStageTable.id, { onDelete: 'cascade' }),
  capiEventTypeId: integer('capi_event_type_id').notNull()
    .references(() => metaCapiEventTypesTable.id, { onDelete: 'restrict' }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
