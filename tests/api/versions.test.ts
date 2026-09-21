import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEvent } from '../../apps/api/src/modules/events/events.service.ts';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { buildTestApp, signUp, type Client } from '../helpers/session.ts';

describe.skipIf(!testDatabaseUrl)('historial y restauración de eventos', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let app: Client;
  let calendarId: string;

  beforeAll(() => resetDatabase(pool));
  afterAll(() => pool.end());

  beforeEach(async () => {
    await pool.query('TRUNCATE event_versions, events, calendars, users CASCADE');
    const user = await signUp(await buildTestApp(pool));
    app = user.client;
    calendarId = user.calendarId;
  });

  const gym = () => ({
    calendarId,
    title: 'Gym',
    startAt: '2026-09-21T08:00:00Z',
    endAt: '2026-09-21T09:00:00Z',
    timezone: 'Europe/Madrid',
  });
  const post = (payload: object) => app.inject({ method: 'POST', url: '/events', payload });
  const patch = (id: string, payload: object) =>
    app.inject({ method: 'PATCH', url: `/events/${id}`, payload });
  const del = (id: string) => app.inject({ method: 'DELETE', url: `/events/${id}` });
  const versions = async (id: string) =>
    (await app.inject({ method: 'GET', url: `/events/${id}/versions` })).json();
  const restore = (id: string, version: number, payload?: object) =>
    app.inject({ method: 'POST', url: `/events/${id}/restore/${version}`, payload });
  const rowCount = async (id: string) =>
    (await pool.query('SELECT count(*)::int AS n FROM event_versions WHERE event_id = $1', [id]))
      .rows[0].n as number;

  /** Evento con 3 versiones: Gym 10:00 → Gym 11:00 → Gym 11:00 en «Sala 2». */
  async function eventWithHistory(): Promise<string> {
    const { id } = (await post(gym())).json();
    await patch(id, { startAt: '2026-09-21T09:00:00Z', endAt: '2026-09-21T10:00:00Z' });
    await patch(id, { location: 'Sala 2', changeReason: 'cambio de sala' });
    return id;
  }

  describe('consultar el historial', () => {
    it('lista las versiones de la más reciente a la más antigua, con qué cambió en cada una', async () => {
      const id = await eventWithHistory();
      const list = await versions(id);

      expect(list.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
      expect(list.map((v: { isCurrent: boolean }) => v.isCurrent)).toEqual([true, false, false]);
      expect(list[0]).toMatchObject({
        location: 'Sala 2',
        changeReason: 'cambio de sala',
        changes: [{ field: 'location', from: '', to: 'Sala 2' }],
      });
      expect(list[1].changes).toEqual([
        { field: 'startAt', from: '2026-09-21T08:00:00.000Z', to: '2026-09-21T09:00:00.000Z' },
        { field: 'endAt', from: '2026-09-21T09:00:00.000Z', to: '2026-09-21T10:00:00.000Z' },
      ]);
      expect(list[2]).toMatchObject({ version: 1, changes: [], changeReason: null });
    });

    it('devuelve una versión concreta', async () => {
      const id = await eventWithHistory();
      const res = await app.inject({ method: 'GET', url: `/events/${id}/versions/2` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        eventId: id,
        version: 2,
        startAt: '2026-09-21T09:00:00.000Z',
      });
    });

    it('responde 404 si la versión o el evento no existen y 400 si los parámetros son inválidos', async () => {
      const id = await eventWithHistory();
      const get = (url: string) => app.inject({ method: 'GET', url });
      expect((await get(`/events/${id}/versions/9`)).statusCode).toBe(404);
      expect((await get(`/events/3f1c2a54-6a5e-4c4b-9f0e-0a4c8f0f6b11/versions`)).statusCode).toBe(
        404,
      );
      expect((await get(`/events/${id}/versions/0`)).statusCode).toBe(400);
      expect((await get(`/events/${id}/versions/abc`)).statusCode).toBe(400);
    });

    it('conserva el historial de un evento borrado y marca el borrado', async () => {
      const id = await eventWithHistory();
      await del(id);
      const list = await versions(id);
      expect(list).toHaveLength(4);
      expect(list[0]).toMatchObject({
        version: 4,
        deleted: true,
        changeReason: 'deleted',
        changes: [{ field: 'deleted', from: false, to: true }],
      });
    });

    it('no muestra el historial de eventos de otro usuario', async () => {
      const other = await pool.query(
        "INSERT INTO users (email, name) VALUES ('x@y.z', 'X') RETURNING id",
      );
      const otherCal = await pool.query(
        "INSERT INTO calendars (user_id, name) VALUES ($1, 'Ajeno') RETURNING id",
        [other.rows[0].id],
      );
      const foreign = await createEvent(pool, other.rows[0].id, {
        ...gym(),
        calendarId: otherCal.rows[0].id,
      });
      const get = (url: string) => app.inject({ method: 'GET', url });
      expect((await get(`/events/${foreign.id}/versions`)).statusCode).toBe(404);
      expect((await get(`/events/${foreign.id}/versions/1`)).statusCode).toBe(404);
      expect((await restore(foreign.id, 1)).statusCode).toBe(404);
    });
  });

  describe('restaurar', () => {
    it('crea una versión nueva con el contenido antiguo y no toca el historial', async () => {
      const id = await eventWithHistory();
      const before = (
        await pool.query('SELECT * FROM event_versions WHERE event_id = $1 ORDER BY version', [id])
      ).rows;

      const res = await restore(id, 1);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        version: 4,
        startAt: '2026-09-21T08:00:00.000Z',
        endAt: '2026-09-21T09:00:00.000Z',
        location: '',
      });

      const list = await versions(id);
      expect(list[0]).toMatchObject({ version: 4, changeReason: 'restored from version 1' });
      // Las versiones 1–3 siguen exactamente igual.
      const after = (
        await pool.query('SELECT * FROM event_versions WHERE event_id = $1 ORDER BY version', [id])
      ).rows;
      expect(after.slice(0, 3)).toEqual(before);
    });

    it('recupera un evento borrado', async () => {
      const id = await eventWithHistory();
      await del(id);
      expect((await app.inject({ method: 'GET', url: `/events/${id}` })).statusCode).toBe(404);

      const res = await restore(id, 3);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ version: 5, title: 'Gym', location: 'Sala 2' });
      expect((await app.inject({ method: 'GET', url: `/events/${id}` })).statusCode).toBe(200);
      const list = await app.inject({
        method: 'GET',
        url: '/events?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z',
      });
      expect(list.json()).toHaveLength(1);
      expect((await versions(id))[0].changes).toEqual([
        { field: 'deleted', from: true, to: false },
      ]);
    });

    it('restaurar la versión que ya es la vigente no crea versión', async () => {
      const id = await eventWithHistory();
      const res = await restore(id, 3);
      expect(res.json().version).toBe(3);
      expect(await rowCount(id)).toBe(3);
    });

    it('restaurar un contenido idéntico al vigente (otra versión) tampoco crea versión', async () => {
      const { id } = (await post(gym())).json();
      await patch(id, { title: 'Otro' });
      await patch(id, { title: 'Gym' }); // v3 == contenido de v1
      expect((await restore(id, 1)).json().version).toBe(3);
      expect(await rowCount(id)).toBe(3);
    });

    it('respeta expectedVersion: desfasada da 409 y no crea versión', async () => {
      const id = await eventWithHistory();
      const stale = await restore(id, 1, { expectedVersion: 2 });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe('version_conflict');
      expect(await rowCount(id)).toBe(3);
      expect((await restore(id, 1, { expectedVersion: 3 })).statusCode).toBe(200);
    });

    it('404 si la versión no existe; 400 con un cuerpo inválido', async () => {
      const id = await eventWithHistory();
      expect((await restore(id, 9)).statusCode).toBe(404);
      expect((await restore(id, 1, { foo: 1 })).statusCode).toBe(400);
    });

    it('deshacer un borrado y volver a borrar deja un historial coherente', async () => {
      const { id } = (await post(gym())).json();
      await del(id); // v2
      await restore(id, 1); // v3
      await del(id); // v4
      const list = await versions(id);
      expect(
        list.map((v: { version: number; deleted: boolean }) => [v.version, v.deleted]),
      ).toEqual([
        [4, true],
        [3, false],
        [2, true],
        [1, false],
      ]);
    });

    it('dos restauraciones concurrentes con la misma expectedVersion: una gana, otra 409', async () => {
      const id = await eventWithHistory();
      const results = await Promise.all([
        restore(id, 1, { expectedVersion: 3 }),
        restore(id, 2, { expectedVersion: 3 }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await rowCount(id)).toBe(4);
    });
  });
});
