import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { buildTestApp, signUp, type Client } from '../helpers/session.ts';

interface Reminder {
  eventId: string;
  title: string;
  minutesBefore: number;
  occurrenceStartAt: string;
  triggerAt: string;
}

describe.skipIf(!testDatabaseUrl)('recordatorios', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let app: Client;
  let other: Client;
  let calendarId: string;

  beforeAll(() => resetDatabase(pool));
  afterAll(() => pool.end());
  beforeEach(async () => {
    await pool.query('TRUNCATE event_versions, events, calendars, categories, users CASCADE');
    const server = await buildTestApp(pool);
    const user = await signUp(server);
    app = user.client;
    calendarId = user.calendarId;
    other = (await signUp(server)).client;
  });

  // 21 sep 2026, 10:00–11:00 en Madrid (08:00Z–09:00Z).
  const event = (over: object = {}) => ({
    calendarId,
    title: 'Reunión',
    startAt: '2026-09-21T08:00:00Z',
    endAt: '2026-09-21T09:00:00Z',
    timezone: 'Europe/Madrid',
    ...over,
  });
  const post = (payload: object) => app.inject({ method: 'POST', url: '/events', payload });
  const patch = (id: string, payload: object) =>
    app.inject({ method: 'PATCH', url: `/events/${id}`, payload });
  const active = async (at: string, client = app): Promise<Reminder[]> =>
    (await client.inject({ method: 'GET', url: `/reminders/active?at=${at}` })).json();
  const versionCount = async (id: string) =>
    (await pool.query('SELECT count(*)::int AS n FROM event_versions WHERE event_id = $1', [id]))
      .rows[0].n;

  describe('en el evento', () => {
    it('se guardan sin repetidos y ordenados de menor a mayor', async () => {
      const res = await post(event({ reminders: [30, 10, 10, 1440] }));
      expect(res.statusCode).toBe(201);
      expect(res.json().reminders).toEqual([10, 30, 1440]);
    });

    it('un evento sin recordatorios devuelve []', async () => {
      expect((await post(event())).json().reminders).toEqual([]);
    });

    it('cambiarlos sustituye el conjunto y NO crea versión (no son contenido versionado)', async () => {
      const { id } = (await post(event({ reminders: [10] }))).json();
      const res = await patch(id, { reminders: [5, 30] });
      expect(res.json()).toMatchObject({ version: 1, reminders: [5, 30] });
      expect(await versionCount(id)).toBe(1);
      expect((await patch(id, { reminders: [] })).json().reminders).toEqual([]);
    });

    it('cambiar contenido y recordatorios a la vez crea una versión y aplica ambos', async () => {
      const { id } = (await post(event())).json();
      const res = await patch(id, { title: 'Otra', reminders: [15] });
      expect(res.json()).toMatchObject({ version: 2, title: 'Otra', reminders: [15] });
    });

    it('restaurar una versión no toca los recordatorios', async () => {
      const { id } = (await post(event({ reminders: [10] }))).json();
      await patch(id, { title: 'Otra', reminders: [20] });
      const restored = await app.inject({ method: 'POST', url: `/events/${id}/restore/1` });
      expect(restored.json()).toMatchObject({ title: 'Reunión', reminders: [20] });
    });

    it.each([
      ['negativo', [-1]],
      ['más de 4 semanas', [40_321]],
      ['no entero', [1.5]],
      ['más de 10', Array.from({ length: 11 }, (_, i) => i)],
    ])('rechaza un recordatorio %s con 400', async (_name, reminders) => {
      expect((await post(event({ reminders }))).statusCode).toBe(400);
    });

    it('GET /events los incluye', async () => {
      await post(event({ reminders: [10] }));
      const res = await app.inject({
        method: 'GET',
        url: '/events?from=2026-09-21T00:00:00Z&to=2026-09-22T00:00:00Z',
      });
      expect(res.json()[0].reminders).toEqual([10]);
    });
  });

  describe('avisos activos', () => {
    it('aparece cuando llega la hora del aviso y sigue mientras el evento no termine', async () => {
      const { id } = (await post(event({ reminders: [30] }))).json();
      expect(await active('2026-09-21T07:29:59Z')).toEqual([]); // 09:29:59 en Madrid
      const atTrigger = await active('2026-09-21T07:30:00Z');
      expect(atTrigger).toMatchObject([
        { eventId: id, title: 'Reunión', minutesBefore: 30, triggerAt: '2026-09-21T07:30:00.000Z' },
      ]);
      expect(await active('2026-09-21T08:30:00Z')).toHaveLength(1); // en curso
      expect(await active('2026-09-21T09:00:00Z')).toEqual([]); // ya terminó
    });

    it('cada recordatorio dispara a su hora, ordenados por hora de aviso', async () => {
      await post(event({ reminders: [10, 60] }));
      expect((await active('2026-09-21T07:05:00Z')).map((r) => r.minutesBefore)).toEqual([60]);
      expect((await active('2026-09-21T07:55:00Z')).map((r) => r.minutesBefore)).toEqual([60, 10]);
    });

    it('un recordatorio de 0 minutos avisa al empezar', async () => {
      await post(event({ reminders: [0] }));
      expect(await active('2026-09-21T07:59:59Z')).toEqual([]);
      expect(await active('2026-09-21T08:00:00Z')).toHaveLength(1);
    });

    it('no avisa de eventos cancelados, borrados ni sin recordatorios', async () => {
      const cancelled = (
        await post(event({ title: 'Cancelado', status: 'cancelled', reminders: [10] }))
      ).json();
      const deleted = (await post(event({ title: 'Borrado', reminders: [10] }))).json();
      await post(event({ title: 'Sin aviso' }));
      await app.inject({ method: 'DELETE', url: `/events/${deleted.id}` });
      expect(await active('2026-09-21T07:55:00Z')).toEqual([]);
      // Reactivarlo lo hace avisar.
      await patch(cancelled.id, { status: 'confirmed' });
      expect((await active('2026-09-21T07:55:00Z')).map((r) => r.title)).toEqual(['Cancelado']);
    });

    it('en una serie, avisa por la ocurrencia que toca', async () => {
      await post(event({ recurrence: { freq: 'daily', interval: 1 }, reminders: [15] }));
      // 25 sep 09:50 en Madrid (07:50Z): la del 25 avisa a las 09:45.
      const reminders = await active('2026-09-25T07:50:00Z');
      expect(reminders).toMatchObject([
        { occurrenceStartAt: '2026-09-25T08:00:00.000Z', triggerAt: '2026-09-25T07:45:00.000Z' },
      ]);
      // Entre ocurrencias no hay avisos.
      expect(await active('2026-09-25T15:00:00Z')).toEqual([]);
    });

    it('una serie que aún no ha empezado avisa antes de su primera ocurrencia', async () => {
      await post(event({ recurrence: { freq: 'daily', interval: 1 }, reminders: [1440] }));
      // Un día antes de la primera (20 sep, 10:00 Madrid).
      expect(await active('2026-09-20T07:59:00Z')).toEqual([]);
      const reminders = await active('2026-09-20T08:00:00Z');
      expect(reminders.map((r) => r.occurrenceStartAt)).toEqual(['2026-09-21T08:00:00.000Z']);
    });

    it('sin `at` usa la hora actual', async () => {
      const soon = new Date(Date.now() + 5 * 60_000);
      await post(
        event({
          startAt: soon.toISOString(),
          endAt: new Date(soon.getTime() + 3_600_000).toISOString(),
          reminders: [10],
        }),
      );
      const res = await app.inject({ method: 'GET', url: '/reminders/active' });
      expect(res.json()).toHaveLength(1);
    });

    it('cada usuario solo ve los suyos', async () => {
      await post(event({ reminders: [10] }));
      expect(await active('2026-09-21T07:55:00Z', other)).toEqual([]);
    });

    it('exige sesión y valida `at`', async () => {
      const server = await buildTestApp(pool);
      expect((await server.inject({ method: 'GET', url: '/reminders/active' })).statusCode).toBe(
        401,
      );
      expect(
        (await app.inject({ method: 'GET', url: '/reminders/active?at=ayer' })).statusCode,
      ).toBe(400);
    });
  });
});
