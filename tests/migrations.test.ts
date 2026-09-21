import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

// Requiere PostgreSQL: `pnpm db:up` en local; en CI lo aporta un service container.
describe.skipIf(!url)('migraciones', () => {
  const client = new pg.Client({ connectionString: url });
  const migrate = (direction: 'up' | 'down', count: number) =>
    runner({
      databaseUrl: url!,
      dir: 'migrations',
      direction,
      count,
      migrationsTable: 'pgmigrations',
      log: () => {},
    });

  beforeAll(async () => {
    await client.connect();
    // Partimos de una base vacía: es la garantía que pide el MVP.
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  });
  afterAll(() => client.end());

  it('aplican sobre una base vacía', async () => {
    await migrate('up', Infinity);
    const { rows } = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'citext'");
    expect(rows).toHaveLength(1);
  });

  it('son reversibles', async () => {
    await migrate('down', Infinity);
    const { rows } = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'citext'");
    expect(rows).toHaveLength(0);
  });
});
