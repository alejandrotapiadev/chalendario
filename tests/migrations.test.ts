import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dropEverything, migrate, testDatabaseUrl } from './helpers/db.ts';

const TABLES = ['calendars', 'event_versions', 'events', 'users'];

// Requiere PostgreSQL: `pnpm db:up` en local; en CI lo aporta un service container.
describe.skipIf(!testDatabaseUrl)('migraciones', () => {
  const client = new pg.Client({ connectionString: testDatabaseUrl });

  const userTables = async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> 'pgmigrations' ORDER BY table_name`,
    );
    return rows.map((r) => r.table_name);
  };

  beforeAll(async () => {
    await client.connect();
    // Partimos de una base vacía: es la garantía que pide el MVP.
    await dropEverything(client);
  });
  afterAll(() => client.end());

  it('aplican sobre una base vacía', async () => {
    await migrate('up');
    expect(await userTables()).toEqual(TABLES);
  });

  it('son reversibles', async () => {
    await migrate('down');
    expect(await userTables()).toEqual([]);
    const { rows } = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'citext'");
    expect(rows).toHaveLength(0);
  });
});
