import { runner } from 'node-pg-migrate';
import pg from 'pg';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export function migrate(direction: 'up' | 'down', count = Infinity): Promise<unknown> {
  return runner({
    databaseUrl: testDatabaseUrl!,
    dir: 'migrations',
    direction,
    count,
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}

/** Deja la base de datos de test vacía (sin esquema ni extensiones). */
export async function dropEverything(pool: pg.Pool | pg.Client): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

/** Base vacía + todas las migraciones aplicadas: el estado de partida de cada suite. */
export async function resetDatabase(pool: pg.Pool | pg.Client): Promise<void> {
  await dropEverything(pool);
  await migrate('up');
}
