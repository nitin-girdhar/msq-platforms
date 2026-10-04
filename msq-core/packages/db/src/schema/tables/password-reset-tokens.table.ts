import { uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { iamSchema } from '../pg-schemas';
import { usersTable } from './users.table';

// iam.password_reset_tokens (1.57.0) — SHA-256 of the emailed token only.
// Service transaction only (deny-all RLS + REVOKE for application roles).
export const passwordResetTokensTable = iamSchema.table('password_reset_tokens', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:      uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  tokenHash:   text('token_hash').notNull(),
  expiresAt:   timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt:      timestamp('used_at', { withTimezone: true }),
  requestedIp: text('requested_ip'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
