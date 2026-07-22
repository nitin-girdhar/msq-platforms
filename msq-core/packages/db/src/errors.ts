export type DbErrorKind =
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'not_found'
  | 'unknown';

export class DatabaseError extends Error {
  constructor(
    public readonly kind: DbErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// Extract a PostgreSQL SQLSTATE code from an error, walking the `cause` chain.
// drizzle-orm wraps driver errors (DrizzleQueryError) and puts the original
// postgres.js error — which carries `.code` (e.g. '23505') — on `.cause`, so a
// direct `err.code` check misses it and unique-violation handling silently falls
// through to a 500. This walks a few levels to find the code wherever it sits.
export function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export function fromPgError(err: unknown): DatabaseError {
  const pgErr = { code: pgErrorCode(err), message: (err as { message?: string }).message };
  switch (pgErr.code) {
    case '23505':
      return new DatabaseError('unique_violation', pgErr.message ?? 'Unique constraint violated');
    case '23503':
      return new DatabaseError('foreign_key_violation', pgErr.message ?? 'Foreign key constraint violated');
    default:
      return new DatabaseError('unknown', pgErr.message ?? 'Unknown database error');
  }
}

export function notFound(entity: string): DatabaseError {
  return new DatabaseError('not_found', `${entity} not found`);
}

export function isDatabaseError(err: unknown): err is DatabaseError {
  return err instanceof DatabaseError;
}
