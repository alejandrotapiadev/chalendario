import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { buildTestApp, signUp, type Client } from '../helpers/session.ts';

describe.skipIf(!testDatabaseUrl)('búsqueda de eventos', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let app: Client;
  let other: Client;
  let calendarId: string;
  let otherCalendarId: string;

  beforeAll(() => resetDatabase(pool));
  afterAll(() => pool.end());
  beforeEach(async () => {
    await pool.query('TRUNCATE event_versions, events, calendars, categories, users CASCADE');
    const server = await buildTestApp(pool);
    const user = await signUp(server);
    app = user.client;
    calendarId = user.calendarId;
    const second = await signUp(server);
    other = second.client;
    otherCalendarId = second.calendarId;
  });

  const create = (over: object, client = app, cal = calendarId) =>
    client.inject({
      method: 'POST',
      url: '/events',
      payload: {
        calendarId: cal,
        title: 'Evento',
        startAt: '2026-09-21T08:00:00Z',
        endAt: '2026-09-21T09:00:00Z',
        timezone: 'Europe/Madrid',
        ...over,
      },
    });
  const search = async (q: string, extra = '', client = app): Promise<{ title: string }[]> => {
    const res = await client.inject({
      method: 'GET',
      url: `/events/search?q=${encodeURIComponent(q)}${extra}`,
    });
    return res.json();
  };
  const titles = (list: { title: string }[]) => list.map((e) => e.title);

  it('busca en título, descripción y ubicación', async () => {
    await create({ title: 'Dentista' });
    await create({ title: 'Otra cosa', description: 'llamar al dentista antes' });
    await create({ title: 'Cita', location: 'Clínica dentista Sol' });
    await create({ title: 'Gimnasio' });
    expect(titles(await search('dentista')).sort()).toEqual(['Cita', 'Dentista', 'Otra cosa']);
  });

  it('no distingue mayúsculas ni acentos, en ninguno de los dos sentidos', async () => {
    await create({ title: 'Reunión de equipo' });
    await create({ title: 'Cumpleaños' });
    expect(titles(await search('reunion'))).toEqual(['Reunión de equipo']);
    expect(titles(await search('REUNIÓN'))).toEqual(['Reunión de equipo']);
    expect(titles(await search('cumpleanos'))).toEqual(['Cumpleaños']);
  });

  it('busca coincidencias parciales', async () => {
    await create({ title: 'Reunión de equipo' });
    expect(titles(await search('nión de eq'))).toEqual(['Reunión de equipo']);
  });

  it('trata % y _ como texto literal, no como comodines', async () => {
    await create({ title: 'Descuento 50%' });
    await create({ title: 'Descuento 5000' });
    await create({ title: 'a_b' });
    await create({ title: 'aXb' });
    expect(titles(await search('50%'))).toEqual(['Descuento 50%']);
    expect(titles(await search('a_b'))).toEqual(['a_b']);
    expect(await search('%')).toHaveLength(1);
  });

  it('ordena lo más reciente primero y respeta el límite', async () => {
    await create({
      title: 'Cita 1',
      startAt: '2026-09-01T08:00:00Z',
      endAt: '2026-09-01T09:00:00Z',
    });
    await create({
      title: 'Cita 3',
      startAt: '2026-09-03T08:00:00Z',
      endAt: '2026-09-03T09:00:00Z',
    });
    await create({
      title: 'Cita 2',
      startAt: '2026-09-02T08:00:00Z',
      endAt: '2026-09-02T09:00:00Z',
    });
    expect(titles(await search('cita'))).toEqual(['Cita 3', 'Cita 2', 'Cita 1']);
    expect(titles(await search('cita', '&limit=2'))).toEqual(['Cita 3', 'Cita 2']);
  });

  it('busca en cualquier fecha, no solo en un rango', async () => {
    await create({
      title: 'Antiguo',
      startAt: '2020-01-01T08:00:00Z',
      endAt: '2020-01-01T09:00:00Z',
    });
    await create({
      title: 'Futuro',
      startAt: '2031-01-01T08:00:00Z',
      endAt: '2031-01-01T09:00:00Z',
    });
    expect(titles(await search('o')).sort()).toEqual(['Antiguo', 'Futuro']);
  });

  it('un evento recurrente sale una sola vez, con los datos de la serie', async () => {
    await create({ title: 'Yoga', recurrence: { freq: 'daily', interval: 1 } });
    const found = await search('yoga');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      recurrence: { freq: 'daily', interval: 1 },
      startAt: '2026-09-21T08:00:00.000Z',
    });
  });

  it('excluye eventos borrados y los recupera al restaurarlos', async () => {
    const { id } = (await create({ title: 'Temporal' })).json();
    await app.inject({ method: 'DELETE', url: `/events/${id}` });
    expect(await search('temporal')).toEqual([]);
    await app.inject({ method: 'POST', url: `/events/${id}/restore/1` });
    expect(titles(await search('temporal'))).toEqual(['Temporal']);
  });

  it('la búsqueda usa el contenido vigente, no el de versiones antiguas', async () => {
    const { id } = (await create({ title: 'Nombre viejo' })).json();
    await app.inject({ method: 'PATCH', url: `/events/${id}`, payload: { title: 'Nombre nuevo' } });
    expect(await search('viejo')).toEqual([]);
    expect(titles(await search('nuevo'))).toEqual(['Nombre nuevo']);
  });

  it('solo busca entre los eventos del propio usuario', async () => {
    await create({ title: 'Secreto de Ana' });
    await create({ title: 'Secreto de Luis' }, other, otherCalendarId);
    expect(titles(await search('secreto'))).toEqual(['Secreto de Ana']);
    expect(titles(await search('secreto', '', other))).toEqual(['Secreto de Luis']);
  });

  it.each([
    ['q vacío', ''],
    ['q solo espacios', '   '],
  ])('rechaza %s con 400', async (_name, q) => {
    const res = await app.inject({
      method: 'GET',
      url: `/events/search?q=${encodeURIComponent(q)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza un límite fuera de rango y parámetros desconocidos', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/events/search?q=a&limit=0' })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/events/search?q=a&limit=51' })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/events/search?q=a&foo=1' })).statusCode).toBe(
      400,
    );
  });

  it('/events/search no se confunde con /events/:id', async () => {
    expect((await app.inject({ method: 'GET', url: '/events/search?q=x' })).statusCode).toBe(200);
  });
});
