import { uuid, primaryKey } from 'drizzle-orm/pg-core';
import { extSchema } from '../pg-schemas';
import { apiClientsTable } from './api-clients.table';
import { organizationsTable } from './organizations.table';

// Junction: which branches an api_clients row is scoped to. Zero rows for a
// client means tenant-wide (only valid when api_clients.scope_all_orgs = true).
export const apiClientOrgsTable = extSchema.table('api_client_orgs', {
  apiClientId: uuid('api_client_id').notNull().references(() => apiClientsTable.id, { onDelete: 'cascade' }),
  orgId:       uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.apiClientId, t.orgId] }),
}));
