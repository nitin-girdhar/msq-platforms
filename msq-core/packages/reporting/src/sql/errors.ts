// ── Compiler and execution errors ────────────────────────────────────────────
// Every rejection the compiler makes is a 400, not a 500: the spec came from a
// client, and a client that asked for something illegal deserves to be told
// what. The one exception is a scope it holds no column for — that is a 403,
// because widening instead would silently show rows the actor may not see.

export type ReportErrorKind =
  /** Spec references something the dataset does not declare, or a shape the
   *  compiler cannot build. Client's fault, fixable by the client. */
  | 'invalid_spec'
  /** Actor lacks the capability, or the dataset cannot express the scope the
   *  actor resolved to. Never widen — fail. */
  | 'forbidden'
  /** Query exceeded statement_timeout, or would exceed a cell/group cap. */
  | 'too_large'
  /** Dataset key not in the registry. */
  | 'unknown_dataset';

export class ReportError extends Error {
  readonly kind: ReportErrorKind;
  /** Field/measure/filter path the problem attaches to, when there is one. */
  readonly path?: string;

  constructor(kind: ReportErrorKind, message: string, path?: string) {
    super(message);
    this.name = 'ReportError';
    this.kind = kind;
    if (path !== undefined) this.path = path;
  }

  /** HTTP status a controller should map this to. */
  get statusCode(): number {
    switch (this.kind) {
      case 'forbidden':
        return 403;
      case 'unknown_dataset':
        return 404;
      case 'invalid_spec':
      case 'too_large':
        return 400;
    }
  }
}

export function invalidSpec(message: string, path?: string): ReportError {
  return new ReportError('invalid_spec', message, path);
}

/**
 * Index a closed Record with a key that TypeScript believes is valid but which
 * may not be at runtime.
 *
 * Every vocabulary in this package is a closed union, so `MAP[key]` type-checks.
 * At runtime the key can still be anything: a spec read out of
 * report_definitions.spec JSONB, or a request body that reached the compiler
 * without passing zod. A plain lookup then yields `undefined`, which drizzle
 * interpolates into the query rather than rejecting — a silent hole exactly where
 * the whitelist is supposed to be airtight.
 *
 * Use this for EVERY Record lookup keyed off spec data that is not already
 * gated by an `includes()` check against the dataset definition.
 */
export function requireKey<T>(
  map: Readonly<Record<string, T>>,
  key: string,
  what: string,
  path?: string,
): T {
  const value = map[key];
  if (value === undefined) {
    throw new ReportError('invalid_spec', `Unsupported ${what} '${key}'.`, path);
  }
  return value;
}

/** Postgres query_canceled — what statement_timeout raises. */
const SQLSTATE_QUERY_CANCELED = '57014';
/** Postgres out_of_memory / configuration_limit_exceeded, seen on pathological
 *  GROUP BY cardinality. */
const SQLSTATE_OUT_OF_MEMORY = '53200';

/**
 * Turn a driver error into something a user can act on.
 *
 * A statement_timeout is NOT a server fault — it means the report asked for too
 * much. Reporting it as a 500 sends the user to support for a problem they can
 * fix by narrowing a date range, so it maps to `too_large` with that advice.
 * Anything else is rethrown untouched: an unexpected DB error must not be
 * disguised as a user error.
 */
export function mapReportDbError(err: unknown): never {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === SQLSTATE_QUERY_CANCELED) {
    throw new ReportError(
      'too_large',
      'The report took too long to run. Narrow the date range, remove a breakdown field, or filter to fewer records.',
    );
  }
  if (code === SQLSTATE_OUT_OF_MEMORY) {
    throw new ReportError(
      'too_large',
      'The report produced too many groups to aggregate. Add a filter or use a coarser date bucket.',
    );
  }
  throw err;
}
