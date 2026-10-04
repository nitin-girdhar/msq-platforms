import { uuid, text, boolean, integer, numeric, date, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// An employee's uploaded paperwork (schema 1.65.0). Bytes live in blob storage under file_key.
// No org-wide policy: self (own rows) + tenant_admin; HR reads through the service transaction.
// category: id_proof | address_proof | education | employment | tax_proof | medical | other.
// status: pending | verified | rejected (reviewed_at is set exactly when status is not pending).
export const employeeDocumentsTable = hrSchema.table('employee_documents', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:      uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  userId:     uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  category:   text('category').notNull(),
  title:      text('title').notNull(),
  fileKey:    text('file_key').notNull(),
  fileName:   text('file_name').notNull(),
  mimeType:   text('mime_type').notNull(),
  sizeBytes:  integer('size_bytes').notNull(),
  status:     text('status').notNull().default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => usersTable.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  expiresOn:  date('expires_on'),
  taxSection: text('tax_section'),
  amount:     numeric('amount', { precision: 15, scale: 2 }),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
