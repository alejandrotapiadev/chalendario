import pg from 'pg';

export type Db = pg.Pool;

/** Lo mínimo que necesitan los repositorios: sirve tanto un pool como un cliente de transacción. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Ejecuta `fn` en una transacción: COMMIT si termina bien, ROLLBACK si lanza. */
export async function withTransaction<T>(db: Db, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Violación de una restricción UNIQUE (código SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}
