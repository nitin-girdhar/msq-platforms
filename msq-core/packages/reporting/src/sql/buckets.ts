// ── Date bucketing ───────────────────────────────────────────────────────────
// `date_trunc` at a caller-chosen granularity, in the org's timezone.
//
// Note what is and is not a parameter. The granularity ('day', 'month', …) is
// SOURCE TEXT inside a template literal — it is a key of a closed Record, so it
// can only ever be one of five words written in this file. The timezone IS a
// bound parameter, validated by isValidTimeZone before it gets here. Neither
// path can carry request text into the query.
//
// WHY THE TIMEZONE MATTERS: `date_trunc('day', created_at)` on a timestamptz
// truncates in UTC. For an Asia/Kolkata org (UTC+5:30) that puts everything
// created before 05:30 local into the previous day, so "leads today" in a
// report disagrees with "leads today" in the leads list. The `AT TIME ZONE`
// conversion is what makes the two agree, and it is why every temporal
// dimension is bucketed through this map rather than truncated inline.
//
// `ts AT TIME ZONE $tz` converts timestamptz → naive local timestamp, we
// truncate that, and the result is returned as a naive local timestamp. The
// client formats it as-is; it must NOT re-interpret it as UTC.

import { sql, type SQL } from 'drizzle-orm';
import type { DateBucket } from '../spec/types.js';

export const BUCKET: Readonly<Record<DateBucket, (expr: SQL, tz: SQL) => SQL>> = {
  day: (expr, tz) => sql`date_trunc('day', ${expr} AT TIME ZONE ${tz})`,
  // Postgres weeks start Monday (ISO 8601).
  week: (expr, tz) => sql`date_trunc('week', ${expr} AT TIME ZONE ${tz})`,
  month: (expr, tz) => sql`date_trunc('month', ${expr} AT TIME ZONE ${tz})`,
  quarter: (expr, tz) => sql`date_trunc('quarter', ${expr} AT TIME ZONE ${tz})`,
  year: (expr, tz) => sql`date_trunc('year', ${expr} AT TIME ZONE ${tz})`,
} as const;

/** The fallback when neither the spec nor the org supplies one. Matches the
 *  default on entity.organizations.timezone (db_scripts/02_schema.sql). */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
