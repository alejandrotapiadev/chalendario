import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { buildTestApp, signUp, type Client } from '../helpers/session.ts';

describe.skipIf(!testDatabaseUrl)('categorías', () => {
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

  const createCategory = async (payload: object, client = app) =>
    client.inject({ method: 'POST', url: '/categories', payload });
  const event = (over: object = {}) => ({
    calendarId,
    title: 'Dentista',
    startAt: '2026-09-21T08:00:00Z',
    endAt: '2026-09-21T09:00:00Z',
    timezone: 'Europe/Madrid',
    ...over,
  });

  it('crea, lista ordenadas por nombre y edita categorías', async () => {
    const health = await createCategory({ name: 'Salud', color: '#ef4444' });
    expect(health.statusCode).toBe(201);
    await createCategory({ name: 'Ocio' });
    const listed = await app.inject({ method: 'GET', url: '/categories' });
    expect(listed.json().map((c: { name: string }) => c.name)).toEqual(['Ocio', 'Salud']);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/categories/${health.json().id}`,
      payload: { name: 'Bienestar', color: '#22c55e' },
    });
    expect(renamed.json()).toMatchObject({ name: 'Bienestar', color: '#22c55e' });
  });

  it('el nombre es único por usuario sin distinguir mayúsculas: 409', async () => {
    await createCategory({ name: 'Salud' });
    const duplicate = await createCategory({ name: 'SALUD' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('name_taken');
    // Otro usuario sí puede usar el mismo nombre.
    expect((await createCategory({ name: 'Salud' }, other)).statusCode).toBe(201);
  });

  it('renombrar a un nombre ya usado da 409', async () => {
    await createCategory({ name: 'Salud' });
    const { id } = (await createCategory({ name: 'Ocio' })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/categories/${id}`,
      payload: { name: 'salud' },
    });
    expect(res.statusCode).toBe(409);
  });

  it.each([
    ['color inválido', { name: 'X', color: 'rojo' }],
    ['nombre vacío', { name: '  ' }],
    ['campo desconocido', { name: 'X', foo: 1 }],
  ])('rechaza %s con 400', async (_name, payload) => {
    expect((await createCategory(payload)).statusCode).toBe(400);
  });

  it('no permite tocar categorías ajenas ni borrarlas', async () => {
    const { id } = (await createCategory({ name: 'Mía' })).json();
    const patched = await other.inject({
      method: 'PATCH',
      url: `/categories/${id}`,
      payload: { name: 'Robada' },
    });
    expect(patched.statusCode).toBe(404);
    expect((await other.inject({ method: 'GET', url: '/categories' })).json()).toEqual([]);
    // No hay DELETE: las versiones de los eventos referencian la categoría.
    expect((await app.inject({ method: 'DELETE', url: `/categories/${id}` })).statusCode).toBe(404);
  });

  it('archivar y restaurar (ADR-015): sigue listada, con el evento que ya la usaba', async () => {
    const cat = (await createCategory({ name: 'Salud' })).json();
    await app.inject({
      method: 'POST',
      url: '/events',
      payload: event({ categoryId: cat.id }),
    });

    const archived = await app.inject({
      method: 'PATCH',
      url: `/categories/${cat.id}`,
      payload: { archived: true },
    });
    expect(archived.json()).toMatchObject({ archived: true, name: 'Salud' });

    // Sigue en la lista (con la marca) para poder resolver el nombre/color de eventos ya
    // etiquetados y para poder restaurarla.
    const listed = await app.inject({ method: 'GET', url: '/categories' });
    expect(listed.json()).toContainEqual(expect.objectContaining({ id: cat.id, archived: true }));

    const restored = await app.inject({
      method: 'PATCH',
      url: `/categories/${cat.id}`,
      payload: { archived: false },
    });
    expect(restored.json().archived).toBe(false);
  });

  describe('en los eventos', () => {
    it('un evento guarda su categoría y la devuelve', async () => {
      const cat = (await createCategory({ name: 'Salud' })).json();
      const res = await app.inject({
        method: 'POST',
        url: '/events',
        payload: event({ categoryId: cat.id }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().categoryId).toBe(cat.id);
    });

    it('no se puede usar la categoría de otro usuario: 404', async () => {
      const foreign = (await createCategory({ name: 'Ajena' }, other)).json();
      const res = await app.inject({
        method: 'POST',
        url: '/events',
        payload: event({ categoryId: foreign.id }),
      });
      expect(res.statusCode).toBe(404);
    });

    it('cambiar o quitar la categoría crea versión y se ve en el historial', async () => {
      const cat = (await createCategory({ name: 'Salud' })).json();
      const { id } = (
        await app.inject({ method: 'POST', url: '/events', payload: event() })
      ).json();

      const assigned = await app.inject({
        method: 'PATCH',
        url: `/events/${id}`,
        payload: { categoryId: cat.id },
      });
      expect(assigned.json()).toMatchObject({ version: 2, categoryId: cat.id });
      const cleared = await app.inject({
        method: 'PATCH',
        url: `/events/${id}`,
        payload: { categoryId: null },
      });
      expect(cleared.json()).toMatchObject({ version: 3, categoryId: null });

      const versions = (await app.inject({ method: 'GET', url: `/events/${id}/versions` })).json();
      expect(versions[1].changes).toEqual([{ field: 'categoryId', from: null, to: cat.id }]);
      expect(versions[0].changes).toEqual([{ field: 'categoryId', from: cat.id, to: null }]);
    });

    it('restaurar una versión recupera su categoría', async () => {
      const cat = (await createCategory({ name: 'Salud' })).json();
      const { id } = (
        await app.inject({ method: 'POST', url: '/events', payload: event({ categoryId: cat.id }) })
      ).json();
      await app.inject({ method: 'PATCH', url: `/events/${id}`, payload: { categoryId: null } });
      const restored = await app.inject({ method: 'POST', url: `/events/${id}/restore/1` });
      expect(restored.json().categoryId).toBe(cat.id);
    });

    it('filtra por categoría en GET /events, con eventos simples y recurrentes', async () => {
      const cat = (await createCategory({ name: 'Salud' })).json();
      await app.inject({
        method: 'POST',
        url: '/events',
        payload: event({ title: 'Con categoría', categoryId: cat.id }),
      });
      await app.inject({
        method: 'POST',
        url: '/events',
        payload: event({ title: 'Sin categoría' }),
      });
      await app.inject({
        method: 'POST',
        url: '/events',
        payload: event({
          title: 'Serie',
          categoryId: cat.id,
          recurrence: { freq: 'daily', interval: 1 },
        }),
      });
      const res = await app.inject({
        method: 'GET',
        url: `/events?from=2026-09-21T00:00:00Z&to=2026-09-23T00:00:00Z&categoryId=${cat.id}`,
      });
      // Empiezan a la misma hora: el desempate es por id, así que se compara ordenado.
      const titles = res.json().map((e: { title: string }) => e.title);
      expect(titles.sort()).toEqual(['Con categoría', 'Serie', 'Serie']);
    });

    it('categoryId con formato inválido da 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/events',
        payload: event({ categoryId: 'nope' }),
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
