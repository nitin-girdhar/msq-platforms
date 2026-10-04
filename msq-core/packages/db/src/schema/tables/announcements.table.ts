import { uuid, text, boolean, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// Branch announcements (schema 1.63.0). The branch reads PUBLISHED, unexpired rows
// (app_user policy); drafts, publishing and retiring go through the service transaction.
// category: general | policy | event | celebration.
export const announcementsTable = hrSchema.table('announcements', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:       uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  authorId:    uuid('author_id').references(() => usersTable.id, { onDelete: 'set null' }),
  title:       text('title').notNull(),
  body:        text('body').notNull(),
  category:    text('category').notNull().default('general'),
  isPinned:    boolean('is_pinned').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  expiresOn:   date('expires_on'),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Who has read which announcement. Self policy: a person records and reads only their own.
export const announcementReadsTable = hrSchema.table('announcement_reads', {
  announcementId: uuid('announcement_id').notNull().references(() => announcementsTable.id, { onDelete: 'cascade' }),
  userId:         uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  orgId:          uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  readAt:         timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
});
