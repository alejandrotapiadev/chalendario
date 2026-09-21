import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEvent } from '../../apps/api/src/modules/events/events.service.ts';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { buildTestApp, signUp, type Client } from '../helpers/session.ts';

describe.skipIf(!testDatabaseUrl)('API de eventos', () => {
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
  const versionsOf = async (id: string) =>
    (
      await pool.query(
        'SELECT version, title, start_at, deleted, change_reason FROM event_versions WHERE event_id = $1 ORDER BY version',
        [id],
      )
    ).rows;

  describe('calendarios', () => {
    it('crea un calendario «Personal» por defecto', async () => {
      const res = await app.inject({ method: 'GET', url: '/calendars' });
      expect(res.json()).toMatchObject([{ name: 'Personal', color: '#3b82f6' }]);
    });

    it('crea y edita calendarios', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/calendars',
        payload: { name: 'Trabajo', color: '#ff0000' },
      });
      expect(created.statusCode).toBe(201);
      const edited = await app.inject({
        method: 'PATCH',
        url: `/calendars/${created.json().id}`,
        payload: { name: 'Curro' },
      });
      expect(edited.json()).toMatchObject({ name: 'Curro', color: '#ff0000' });
    });

    it('rechaza colores inválidos y calendarios inexistentes', async () => {
      const bad = await app.inject({
        method: 'POST',
        url: '/calendars',
        payload: { name: 'X', color: 'rojo' },
      });
      expect(bad.statusCode).toBe(400);
      const missing = await app.inject({
        method: 'PATCH',
        url: '/calendars/3f1c2a54-6a5e-4c4b-9f0e-0a4c8f0f6b11',
        payload: { name: 'X' },
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('crear', () => {
    it('devuelve 201 con la versión 1 y valores por defecto', async () => {
      const res = await post(gym());
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        calendarId,
        title: 'Gym',
        version: 1,
        description: '',
        location: '',
        allDay: false,
        status: 'confirmed',
        color: null,
        seriesId: null,
        startAt: '2026-09-21T08:00:00.000Z',
      });
      expect(await versionsOf(res.json().id)).toHaveLength(1);
    });

    it('normaliza offsets a UTC', async () => {
      const res = await post({ ...gym(), startAt: '2026-09-21T10:00:00+02:00' });
      expect(res.json().startAt).toBe('2026-09-21T08:00:00.000Z');
    });

    it('acepta eventos de todo el día alineados a medianoche local', async () => {
      const res = await post({
        ...gym(),
        title: 'Vacaciones',
        allDay: true,
        startAt: '2026-09-20T22:00:00Z',
        endAt: '2026-09-21T22:00:00Z',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().allDay).toBe(true);
    });

    it.each([
      ['fin anterior al inicio', { endAt: '2026-09-21T07:00:00Z' }, /endAt/],
      ['título vacío', { title: '  ' }, /title/],
      ['zona horaria desconocida', { timezone: 'Mars/Olympus' }, /timezone/],
      ['todo el día sin medianoche', { allDay: true }, /medianoche/],
    ])('rechaza %s con 400 e issues', async (_name, override, issue) => {
      const res = await post({ ...gym(), ...override });
      expect(res.statusCode).toBe(400);
      expect(res.json().issues.join(' ')).toMatch(issue);
    });

    it('rechaza campos desconocidos, JSON mal formado y calendarios ajenos', async () => {
      expect((await post({ ...gym(), foo: 1 })).statusCode).toBe(400);
      const malformed = await app.inject({
        method: 'POST',
        url: '/events',
        headers: { 'content-type': 'application/json' },
        payload: '{oops',
      });
      expect(malformed.statusCode).toBe(400);

      const other = await pool.query(
        "INSERT INTO users (email, name) VALUES ('x@y.z', 'X') RETURNING id",
      );
      const foreign = await pool.query(
        "INSERT INTO calendars (user_id, name) VALUES ($1, 'Ajeno') RETURNING id",
        [other.rows[0].id],
      );
      const res = await post({ ...gym(), calendarId: foreign.rows[0].id });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('listar por rango', () => {
    it('devuelve los eventos que se solapan con [from, to), ordenados', async () => {
      const at = (h: number, title: string) => ({
        ...gym(),
        title,
        startAt: `2026-09-21T${String(h).padStart(2, '0')}:00:00Z`,
        endAt: `2026-09-21T${String(h + 1).padStart(2, '0')}:00:00Z`,
      });
      await post(at(12, 'C'));
      await post(at(8, 'A'));
      await post(at(10, 'B'));
      await post({
        ...at(9, 'multi'),
        startAt: '2026-09-20T22:00:00Z',
        endAt: '2026-09-21T09:30:00Z',
      });

      const list = async (from: string, to: string) =>
        (await app.inject({ method: 'GET', url: `/events?from=${from}&to=${to}` }))
          .json()
          .map((e: { title: string }) => e.title);

      expect(await list('2026-09-21T00:00:00Z', '2026-09-22T00:00:00Z')).toEqual([
        'multi',
        'A',
        'B',
        'C',
      ]);
      // El evento que termina justo en `from` o empieza justo en `to` no se incluye.
      expect(await list('2026-09-21T09:00:00Z', '2026-09-21T10:00:00Z')).toEqual(['multi']);
      expect(await list('2026-09-22T00:00:00Z', '2026-09-23T00:00:00Z')).toEqual([]);
    });

    it('valida el rango', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/events?from=2026-09-22T00:00:00Z&to=2026-09-21T00:00:00Z',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('editar y versionado', () => {
    it('cada cambio crea una versión nueva y las anteriores no se tocan', async () => {
      const { id } = (await post(gym())).json();
      const v2 = await patch(id, {
        startAt: '2026-09-21T09:00:00Z',
        endAt: '2026-09-21T10:00:00Z',
      });
      expect(v2.statusCode).toBe(200);
      expect(v2.json()).toMatchObject({ version: 2, startAt: '2026-09-21T09:00:00.000Z' });
      const v3 = await patch(id, { location: 'Sala 2', changeReason: 'cambio de sala' });
      expect(v3.json()).toMatchObject({ version: 3, title: 'Gym', location: 'Sala 2' });

      const versions = await versionsOf(id);
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
      expect(versions[0].start_at.toISOString()).toBe('2026-09-21T08:00:00.000Z');
      expect(versions[2].change_reason).toBe('cambio de sala');
    });

    it('un PATCH sin cambios reales no crea versión', async () => {
      const { id } = (await post(gym())).json();
      const res = await patch(id, { title: 'Gym', startAt: '2026-09-21T10:00:00+02:00' });
      expect(res.json().version).toBe(1);
      expect(await versionsOf(id)).toHaveLength(1);
    });

    it('valida el resultado completo: mover el inicio más allá del fin da 400 y no versiona', async () => {
      const { id } = (await post(gym())).json();
      const res = await patch(id, { startAt: '2026-09-21T12:00:00Z' });
      expect(res.statusCode).toBe(400);
      expect(await versionsOf(id)).toHaveLength(1);
    });

    it('permite quitar el color con null', async () => {
      const { id } = (await post({ ...gym(), color: '#112233' })).json();
      expect((await patch(id, { color: null })).json()).toMatchObject({ color: null, version: 2 });
    });

    it('expectedVersion desfasada da 409 y no versiona', async () => {
      const { id } = (await post(gym())).json();
      await patch(id, { title: 'Gym 2' });
      const stale = await patch(id, { title: 'Gym 3', expectedVersion: 1 });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe('version_conflict');
      expect(await versionsOf(id)).toHaveLength(2);
    });

    it('dos ediciones concurrentes con la misma expectedVersion: una gana, otra 409', async () => {
      const { id } = (await post(gym())).json();
      const results = await Promise.all([
        patch(id, { title: 'A', expectedVersion: 1 }),
        patch(id, { title: 'B', expectedVersion: 1 }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await versionsOf(id)).toHaveLength(2);
    });

    it('no permite cambiar el calendario por PATCH', async () => {
      const { id } = (await post(gym())).json();
      expect((await patch(id, { calendarId })).statusCode).toBe(400);
    });
  });

  describe('borrar', () => {
    it('es un borrado lógico: desaparece de la API pero el historial se conserva', async () => {
      const { id } = (await post(gym())).json();
      expect((await app.inject({ method: 'DELETE', url: `/events/${id}` })).statusCode).toBe(204);

      expect((await app.inject({ method: 'GET', url: `/events/${id}` })).statusCode).toBe(404);
      const list = await app.inject({
        method: 'GET',
        url: '/events?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z',
      });
      expect(list.json()).toEqual([]);

      const versions = await versionsOf(id);
      expect(versions).toMatchObject([
        { version: 1, deleted: false },
        { version: 2, deleted: true, change_reason: 'deleted', title: 'Gym' },
      ]);
    });

    it('un evento borrado no se puede editar ni volver a borrar', async () => {
      const { id } = (await post(gym())).json();
      await app.inject({ method: 'DELETE', url: `/events/${id}` });
      expect((await patch(id, { title: 'X' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `/events/${id}` })).statusCode).toBe(404);
    });
  });

  describe('aislamiento entre usuarios', () => {
    it('no expone ni permite tocar eventos de otro usuario', async () => {
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

      expect((await app.inject({ method: 'GET', url: `/events/${foreign.id}` })).statusCode).toBe(
        404,
      );
      expect((await patch(foreign.id, { title: 'X' })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'DELETE', url: `/events/${foreign.id}` })).statusCode,
      ).toBe(404);
      const list = await app.inject({
        method: 'GET',
        url: '/events?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z',
      });
      expect(list.json()).toEqual([]);
    });
  });

  it('responde con JSON 404 en rutas desconocidas y 400 en ids mal formados', async () => {
    expect((await app.inject({ method: 'GET', url: '/nope' })).json().error).toBe('not_found');
    expect((await app.inject({ method: 'GET', url: '/events/no-uuid' })).statusCode).toBe(400);
  });
});
