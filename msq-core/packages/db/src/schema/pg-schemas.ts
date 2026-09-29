import { pgSchema } from 'drizzle-orm/pg-core';

export const geoSchema = pgSchema('geo');
export const entitySchema = pgSchema('entity');
export const iamSchema = pgSchema('iam');
export const lmsSchema = pgSchema('lms');
export const marketingSchema = pgSchema('marketing');
export const auditSchema = pgSchema('audit');
export const extSchema = pgSchema('ext');
export const hrSchema = pgSchema('hr');
export const taskSchema = pgSchema('task');
export const commsSchema = pgSchema('comms');
export const notifySchema = pgSchema('notify');
/**
 * Staging: rows that exist to be reviewed and then thrown away.
 *
 * Deliberately not part of `ext` — the lifecycle is the opposite of everything
 * there. These rows are DELETEd wholesale rather than soft-deleted, carry none
 * of the standard domain columns, and nothing may foreign-key into them.
 */
export const scratchSchema = pgSchema('scratch');
