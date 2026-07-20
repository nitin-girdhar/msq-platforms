import { uuid, text, date, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { holidayCalendarsTable } from './holiday-calendars.table';

export const holidaysTable = hrSchema.table('holidays', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  calendarId:  uuid('calendar_id').notNull().references(() => holidayCalendarsTable.id, { onDelete: 'cascade' }),
  orgId:       uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  holidayDate: date('holiday_date').notNull(),
  name:        text('name').notNull(),
  isOptional:  boolean('is_optional').notNull().default(false),
  isActive:    boolean('is_active').notNull().default(true),
  isDeleted:   boolean('is_deleted').notNull().default(false),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
  deletedBy:   uuid('deleted_by'),
  createdBy:   uuid('created_by'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
