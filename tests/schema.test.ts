import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabaseUrl } from './helpers/db.ts';

describe.skipIf(!testDatabaseUrl)('esquema de eventos', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let userId: string;
  let calendarId: string;

  beforeAll(() => resetDatabase(pool));
  afterAll(() => pool.end());

  beforeEach(async () => {
    await pool.query('TRUNCATE event_versions, events, calendars, users CASCADE');
    userId = (
      await pool.query("INSERT INTO users (email, name) VALUES ('a@b.c', 'A') RETURNING id")
    ).rows[0].id;
    calendarId = (
      await pool.query(
        "INSERT INTO calendars (user_id, name) VALUES ($1, 'Personal') RETURNING id",
        [userId],
      )
    ).rows[0].id;
  });

  /** Inserta un evento con su versión 1, como hace la aplicación. */
  async function insertEvent(): Promise<string> {
    // Transacción obligatoria: la FK a la versión vigente se comprueba al hacer COMMIT.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO events (calendar_id) VALUES ($1) RETURNING id',
        [calendarId],
      );
      const id = rows[0].id as string;
      await client.query(
        `INSERT INTO event_versions (event_id, version, title, start_at, end_at, timezone, created_by)
         VALUES ($1, 1, 'Gym', '2026-09-21T10:00Z', '2026-09-21T11:00Z', 'Europe/Madrid', $2)`,
        [id, userId],
      );
      await client.query('COMMIT');
      return id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  it('permite crear evento y versión 1 en una transacción', async () => {
    const id = await insertEvent();
    const { rows } = await pool.query('SELECT current_version FROM events WHERE id = $1', [id]);
    expect(rows[0].current_version).toBe(1);
  });

  it('rechaza un evento cuya versión vigente no existe', async () => {
    await expect(
      pool.query('INSERT INTO events (calendar_id) VALUES ($1)', [calendarId]),
    ).rejects.toThrow(/events_current_version_fk/);
  });

  it('las versiones son inmutables (UPDATE y DELETE rechazados)', async () => {
    const id = await insertEvent();
    await expect(
      pool.query("UPDATE event_versions SET title = 'Otro' WHERE event_id = $1", [id]),
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query('DELETE FROM event_versions WHERE event_id = $1', [id]),
    ).rejects.toThrow(/immutable/);
  });

  it('no permite dos versiones con el mismo número', async () => {
    const id = await insertEvent();
    await expect(
      pool.query(
        `INSERT INTO event_versions (event_id, version, title, start_at, end_at, timezone, created_by)
         VALUES ($1, 1, 'Gym', '2026-09-21T10:00Z', '2026-09-21T11:00Z', 'UTC', $2)`,
        [id, userId],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('exige que el fin sea posterior al inicio', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO events (calendar_id) VALUES ($1) RETURNING id',
        [calendarId],
      );
      await expect(
        client.query(
          `INSERT INTO event_versions (event_id, version, title, start_at, end_at, timezone, created_by)
           VALUES ($1, 1, 'X', '2026-09-21T10:00Z', '2026-09-21T10:00Z', 'UTC', $2)`,
          [rows[0].id, userId],
        ),
      ).rejects.toThrow(/check/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
