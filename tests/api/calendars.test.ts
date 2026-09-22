import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { buildTestApp, signUp, type Client } from '../helpers/session.ts';

describe.skipIf(!testDatabaseUrl)('calendarios: archivar (ADR-015)', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let app: Client;
  let calendarId: string;

  beforeAll(() => resetDatabase(pool));
  afterAll(() => pool.end());
  beforeEach(async () => {
    await pool.query('TRUNCATE event_versions, events, calendars, categories, users CASCADE');
    const user = await signUp(await buildTestApp(pool));
    app = user.client;
    calendarId = user.calendarId;
  });

  const event = (over: object = {}) => ({
    calendarId,
    title: 'Cena',
    startAt: '2026-09-21T08:00:00Z',
    endAt: '2026-09-21T09:00:00Z',
    timezone: 'Europe/Madrid',
    ...over,
  });

  it('archivar y restaurar: sigue en GET /calendars, con la marca puesta', async () => {
    const archived = await app.inject({
      method: 'PATCH',
      url: `/calendars/${calendarId}`,
      payload: { archived: true },
    });
    expect(archived.json()).toMatchObject({ archived: true });

    const listed = await app.inject({ method: 'GET', url: '/calendars' });
    expect(listed.json()).toContainEqual(
      expect.objectContaining({ id: calendarId, archived: true }),
    );

    const restored = await app.inject({
      method: 'PATCH',
      url: `/calendars/${calendarId}`,
      payload: { archived: false },
    });
    expect(restored.json().archived).toBe(false);
  });

  it('un calendario archivado no admite eventos nuevos: 409', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/calendars/${calendarId}`,
      payload: { archived: true },
    });
    const res = await app.inject({ method: 'POST', url: '/events', payload: event() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('calendar_archived');
  });

  it('un calendario archivado deja de aportar eventos a GET /events y a la búsqueda', async () => {
    const { id } = (await app.inject({ method: 'POST', url: '/events', payload: event() })).json();
    await app.inject({
      method: 'PATCH',
      url: `/calendars/${calendarId}`,
      payload: { archived: true },
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/events?from=2026-09-21T00:00:00Z&to=2026-09-22T00:00:00Z',
    });
    expect(listed.json()).toEqual([]);

    const found = await app.inject({ method: 'GET', url: '/events/search?q=Cena' });
    expect(found.json()).toEqual([]);

    // El evento en sí sigue accesible directamente (no se borró nada).
    const direct = await app.inject({ method: 'GET', url: `/events/${id}` });
    expect(direct.statusCode).toBe(200);
  });
});
