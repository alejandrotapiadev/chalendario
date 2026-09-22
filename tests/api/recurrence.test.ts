import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { buildTestApp, signUp, type Client } from '../helpers/session.ts';

interface Occurrence {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
}

describe.skipIf(!testDatabaseUrl)('eventos recurrentes', () => {
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

  // Lunes 21 sep 2026, 10:00–11:00 en Madrid (CEST, UTC+2).
  const training = (over: object = {}) => ({
    calendarId,
    title: 'Entrenamiento',
    startAt: '2026-09-21T08:00:00Z',
    endAt: '2026-09-21T09:00:00Z',
    timezone: 'Europe/Madrid',
    recurrence: { freq: 'weekly', interval: 1, byWeekday: [0, 2] },
    ...over,
  });
  const post = (payload: object) => app.inject({ method: 'POST', url: '/events', payload });
  const patch = (id: string, payload: object) =>
    app.inject({ method: 'PATCH', url: `/events/${id}`, payload });
  const del = (id: string, query = '') =>
    app.inject({ method: 'DELETE', url: `/events/${id}${query}` });
  const list = async (from: string, to: string, extra = ''): Promise<Occurrence[]> =>
    (await app.inject({ method: 'GET', url: `/events?from=${from}&to=${to}${extra}` })).json();
  const get = (id: string) => app.inject({ method: 'GET', url: `/events/${id}` });

  it('guarda una sola fila y una sola versión, no una por ocurrencia', async () => {
    const res = await post(training());
    expect(res.statusCode).toBe(201);
    expect(res.json().recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [0, 2] });
    expect((await pool.query('SELECT count(*)::int AS n FROM events')).rows[0].n).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM event_versions')).rows[0].n).toBe(1);
  });

  it('GET /events devuelve cada ocurrencia con el id de la serie', async () => {
    const { id } = (await post(training())).json();
    const occurrences = await list('2026-09-21T00:00:00Z', '2026-10-05T00:00:00Z');
    expect(occurrences.map((o) => o.startAt)).toEqual([
      '2026-09-21T08:00:00.000Z',
      '2026-09-23T08:00:00.000Z',
      '2026-09-28T08:00:00.000Z',
      '2026-09-30T08:00:00.000Z',
    ]);
    expect(occurrences.every((o) => o.id === id)).toBe(true);
    expect(occurrences[1]!.endAt).toBe('2026-09-23T09:00:00.000Z');
  });

  it('las ocurrencias se ordenan junto a los eventos que no se repiten', async () => {
    await post(training());
    await post({
      calendarId,
      title: 'Suelto',
      startAt: '2026-09-22T12:00:00Z',
      endAt: '2026-09-22T13:00:00Z',
      timezone: 'Europe/Madrid',
    });
    const titles = (await list('2026-09-21T00:00:00Z', '2026-09-24T00:00:00Z')).map((o) => o.title);
    expect(titles).toEqual(['Entrenamiento', 'Suelto', 'Entrenamiento']);
  });

  it('no devuelve ocurrencias fuera de la ventana ni antes del inicio', async () => {
    await post(training());
    expect(await list('2026-09-01T00:00:00Z', '2026-09-21T00:00:00Z')).toEqual([]);
    expect(await list('2026-09-24T00:00:00Z', '2026-09-27T00:00:00Z')).toEqual([]);
  });

  it('until termina la serie (inclusive) y count limita el total', async () => {
    await post(
      training({ title: 'Hasta', recurrence: { freq: 'daily', interval: 1, until: '2026-09-23' } }),
    );
    await post(training({ title: 'Tres', recurrence: { freq: 'daily', interval: 1, count: 3 } }));
    const all = await list('2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z');
    expect(all.filter((o) => o.title === 'Hasta')).toHaveLength(3);
    expect(all.filter((o) => o.title === 'Tres')).toHaveLength(3);
  });

  it('mantiene la hora local al cruzar el cambio de hora (los instantes UTC cambian)', async () => {
    await post(
      training({
        startAt: '2026-10-23T08:00:00Z', // 10:00 CEST
        endAt: '2026-10-23T09:00:00Z',
        recurrence: { freq: 'daily', interval: 1 },
      }),
    );
    const occurrences = await list('2026-10-23T00:00:00Z', '2026-10-27T00:00:00Z');
    expect(occurrences.map((o) => o.startAt)).toEqual([
      '2026-10-23T08:00:00.000Z',
      '2026-10-24T08:00:00.000Z',
      '2026-10-25T09:00:00.000Z', // ya CET (UTC+1): sigue siendo 10:00 en Madrid
      '2026-10-26T09:00:00.000Z',
    ]);
  });

  it('repite eventos de todo el día conservando medianoche local y duración', async () => {
    await post({
      calendarId,
      title: 'Semana de guardia',
      allDay: true,
      startAt: '2026-10-18T22:00:00Z', // lunes 19 oct 00:00 en Madrid
      endAt: '2026-10-20T22:00:00Z', // miércoles 21 oct 00:00
      timezone: 'Europe/Madrid',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [0] },
    });
    const occurrences = await list('2026-10-19T00:00:00Z', '2026-11-09T00:00:00Z');
    expect(occurrences.map((o) => [o.startAt, o.endAt])).toEqual([
      ['2026-10-18T22:00:00.000Z', '2026-10-20T22:00:00.000Z'],
      ['2026-10-25T23:00:00.000Z', '2026-10-27T23:00:00.000Z'], // tras el cambio de hora
      ['2026-11-01T23:00:00.000Z', '2026-11-03T23:00:00.000Z'],
      ['2026-11-08T23:00:00.000Z', '2026-11-10T23:00:00.000Z'], // lunes 9 nov 00:00 en Madrid
    ]);
  });

  it('GET /events/:id devuelve la serie tal como está definida (primera ocurrencia)', async () => {
    const { id } = (await post(training())).json();
    const res = await app.inject({ method: 'GET', url: `/events/${id}` });
    expect(res.json()).toMatchObject({
      startAt: '2026-09-21T08:00:00.000Z',
      recurrence: { freq: 'weekly', byWeekday: [0, 2] },
    });
  });

  it('weekly sin byWeekday usa el día de la semana del inicio', async () => {
    const res = await post(training({ recurrence: { freq: 'weekly', interval: 2 } }));
    expect(res.json().recurrence).toEqual({ freq: 'weekly', interval: 2, byWeekday: [0] });
  });

  it.each([
    [
      'byWeekday sin el día del inicio',
      { freq: 'weekly', interval: 1, byWeekday: [1] },
      /byWeekday/,
    ],
    ['intervalo 0', { freq: 'daily', interval: 0 }, /interval/],
    ['until y count', { freq: 'daily', interval: 1, until: '2027-01-01', count: 2 }, /excluyentes/],
    ['until anterior al inicio', { freq: 'daily', interval: 1, until: '2026-01-01' }, /anterior/],
  ])('rechaza %s con 400', async (_name, recurrence, issue) => {
    const res = await post(training({ recurrence }));
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.join(' ')).toMatch(issue);
  });

  it('rechaza una frecuencia desconocida y campos extra en la regla', async () => {
    expect((await post(training({ recurrence: { freq: 'yearly', interval: 1 } }))).statusCode).toBe(
      400,
    );
    expect(
      (await post(training({ recurrence: { freq: 'daily', interval: 1, foo: 1 } }))).statusCode,
    ).toBe(400);
  });

  describe('editar la serie', () => {
    it('cambiar la regla crea una versión y el historial la describe', async () => {
      const { id } = (await post(training())).json();
      const res = await patch(id, { recurrence: { freq: 'daily', interval: 1 } });
      expect(res.json()).toMatchObject({ version: 2, recurrence: { freq: 'daily', interval: 1 } });

      const versions = (await app.inject({ method: 'GET', url: `/events/${id}/versions` })).json();
      expect(versions[0].changes).toEqual([
        {
          field: 'recurrence',
          from: { freq: 'weekly', interval: 1, byWeekday: [0, 2] },
          to: { freq: 'daily', interval: 1 },
        },
      ]);
      expect(versions[1].recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [0, 2] });
    });

    it('enviar la misma regla no crea versión', async () => {
      const { id } = (await post(training())).json();
      const res = await patch(id, {
        recurrence: { freq: 'weekly', interval: 1, byWeekday: [2, 0] },
      });
      expect(res.json().version).toBe(1);
    });

    it('recurrence: null deja de repetir el evento', async () => {
      const { id } = (await post(training())).json();
      await patch(id, { recurrence: null });
      const occurrences = await list('2026-09-21T00:00:00Z', '2026-10-21T00:00:00Z');
      expect(occurrences.map((o) => o.startAt)).toEqual(['2026-09-21T08:00:00.000Z']);
    });

    it('convertir un evento normal en recurrente', async () => {
      const { id } = (await post(training({ recurrence: undefined }))).json();
      expect(await list('2026-09-21T00:00:00Z', '2026-10-05T00:00:00Z')).toHaveLength(1);
      await patch(id, { recurrence: { freq: 'daily', interval: 7 } });
      expect(await list('2026-09-21T00:00:00Z', '2026-10-05T00:00:00Z')).toHaveLength(2);
    });

    it('mover la serie a un día que no está en byWeekday da 400', async () => {
      const { id } = (await post(training())).json();
      const res = await patch(id, {
        startAt: '2026-09-22T08:00:00Z',
        endAt: '2026-09-22T09:00:00Z',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('excepciones', () => {
    // Diaria, count 5: 21, 22, 23, 24, 25 sep 2026.
    const daily5 = () =>
      training({ recurrence: { freq: 'daily', interval: 1, count: 5 }, title: 'Entrenamiento' });

    it('scope "this" al editar crea una excepción propia; la serie no cambia', async () => {
      const { id: seriesId } = (await post(daily5())).json();
      const res = await patch(seriesId, {
        title: 'Entreno especial',
        scope: 'this',
        occurrenceStart: '2026-09-23T08:00:00Z',
      });
      expect(res.statusCode).toBe(200);
      const exception = res.json();
      expect(exception.id).not.toBe(seriesId);
      expect(exception.seriesId).toBe(seriesId);
      expect(exception.recurrenceId).toBe('2026-09-23T08:00:00.000Z');
      expect(exception.recurrence).toBeNull();

      const occurrences = await list('2026-09-21T00:00:00Z', '2026-09-26T00:00:00Z');
      expect(occurrences.map((o) => [o.id, o.title])).toEqual([
        [seriesId, 'Entrenamiento'],
        [seriesId, 'Entrenamiento'],
        [exception.id, 'Entreno especial'],
        [seriesId, 'Entrenamiento'],
        [seriesId, 'Entrenamiento'],
      ]);

      // La regla que llegue en el body de un scope "this" se ignora: una excepción no repite.
      const withRule = await patch(seriesId, {
        scope: 'this',
        occurrenceStart: '2026-09-24T08:00:00Z',
        recurrence: { freq: 'daily', interval: 1 },
      });
      expect(withRule.json().recurrence).toBeNull();
    });

    it('scope "this" al borrar quita solo esa fecha; las demás siguen', async () => {
      const { id: seriesId } = (await post(daily5())).json();
      const res = await del(seriesId, '?scope=this&occurrenceStart=2026-09-23T08:00:00Z');
      expect(res.statusCode).toBe(204);
      const titles = (await list('2026-09-21T00:00:00Z', '2026-09-26T00:00:00Z')).map(
        (o) => o.startAt,
      );
      expect(titles).toEqual([
        '2026-09-21T08:00:00.000Z',
        '2026-09-22T08:00:00.000Z',
        '2026-09-24T08:00:00.000Z',
        '2026-09-25T08:00:00.000Z',
      ]);
    });

    it('una excepción ya creada se edita como un evento suelto normal, con su propio historial', async () => {
      const { id: seriesId } = (await post(daily5())).json();
      const created = (
        await patch(seriesId, {
          title: 'v1',
          scope: 'this',
          occurrenceStart: '2026-09-23T08:00:00Z',
        })
      ).json();

      const edited = await patch(created.id, { title: 'v2' });
      expect(edited.json()).toMatchObject({ id: created.id, version: 2, title: 'v2' });

      const versions = (
        await app.inject({ method: 'GET', url: `/events/${created.id}/versions` })
      ).json();
      expect(versions.map((v: { version: number; title: string }) => [v.version, v.title])).toEqual(
        [
          [2, 'v2'],
          [1, 'v1'],
        ],
      );

      const restored = await app.inject({
        method: 'POST',
        url: `/events/${created.id}/restore/1`,
      });
      expect(restored.json().title).toBe('v1');
    });

    it('scope "following" con count recalcula la serie nueva y trunca la antigua', async () => {
      const { id: seriesId } = (await post(daily5())).json();
      const res = await patch(seriesId, {
        title: 'Nuevo horario',
        scope: 'following',
        occurrenceStart: '2026-09-23T08:00:00Z',
      });
      expect(res.statusCode).toBe(200);
      const newSeries = res.json();
      expect(newSeries.id).not.toBe(seriesId);
      expect(newSeries.recurrence).toEqual({ freq: 'daily', interval: 1, count: 3 });
      expect(newSeries.seriesId).toBeNull(); // es una serie propia, no una excepción

      const oldSeries = (await get(seriesId)).json();
      expect(oldSeries.recurrence).toEqual({ freq: 'daily', interval: 1, until: '2026-09-22' });

      const titles = (await list('2026-09-21T00:00:00Z', '2026-09-26T00:00:00Z')).map(
        (o) => o.title,
      );
      expect(titles).toEqual([
        'Entrenamiento',
        'Entrenamiento',
        'Nuevo horario',
        'Nuevo horario',
        'Nuevo horario',
      ]);
    });

    it('scope "following" con until conserva el mismo fin en la serie nueva', async () => {
      const { id: seriesId } = (
        await post(
          training({
            recurrence: { freq: 'daily', interval: 1, until: '2026-09-30' },
            title: 'Entrenamiento',
          }),
        )
      ).json();
      const res = await patch(seriesId, {
        scope: 'following',
        occurrenceStart: '2026-09-25T08:00:00Z',
      });
      expect(res.json().recurrence).toEqual({ freq: 'daily', interval: 1, until: '2026-09-30' });
      const oldSeries = (await get(seriesId)).json();
      expect(oldSeries.recurrence).toEqual({ freq: 'daily', interval: 1, until: '2026-09-24' });
    });

    it('cortar "following" en la primera ocurrencia borra la serie antigua entera', async () => {
      const { id: seriesId } = (await post(daily5())).json();
      const res = await patch(seriesId, {
        title: 'Desde el principio',
        scope: 'following',
        occurrenceStart: '2026-09-21T08:00:00Z',
      });
      expect(res.json().recurrence).toEqual({ freq: 'daily', interval: 1, count: 5 });
      expect((await get(seriesId)).statusCode).toBe(404);
    });

    it('"following" reasigna a la serie nueva las excepciones posteriores al corte', async () => {
      const { id: seriesId } = (await post(daily5())).json();
      await patch(seriesId, {
        title: 'Especial',
        scope: 'this',
        occurrenceStart: '2026-09-23T08:00:00Z',
      });

      // Corte en la primera ocurrencia: la serie vieja desaparece del todo, así que la
      // excepción solo sigue siendo visible si se reasignó a la serie nueva.
      await patch(seriesId, {
        title: 'Nueva serie',
        scope: 'following',
        occurrenceStart: '2026-09-21T08:00:00Z',
      });

      const titles = (await list('2026-09-21T00:00:00Z', '2026-09-26T00:00:00Z')).map(
        (o) => o.title,
      );
      expect(titles).toEqual([
        'Nueva serie',
        'Nueva serie',
        'Especial',
        'Nueva serie',
        'Nueva serie',
      ]);
    });

    it('"following" al borrar cancela las excepciones posteriores al corte', async () => {
      const { id: seriesId } = (await post(daily5())).json();
      const exception = (
        await patch(seriesId, {
          title: 'Especial',
          scope: 'this',
          occurrenceStart: '2026-09-23T08:00:00Z',
        })
      ).json();

      const res = await del(seriesId, '?scope=following&occurrenceStart=2026-09-23T08:00:00Z');
      expect(res.statusCode).toBe(204);

      const titles = (await list('2026-09-21T00:00:00Z', '2026-09-26T00:00:00Z')).map(
        (o) => o.startAt,
      );
      expect(titles).toEqual(['2026-09-21T08:00:00.000Z', '2026-09-22T08:00:00.000Z']);
      expect((await get(exception.id)).statusCode).toBe(404);
    });

    it('occurrenceStart que no es una ocurrencia real da 400', async () => {
      const { id: seriesId } = (await post(daily5())).json();
      const res = await patch(seriesId, {
        title: 'x',
        scope: 'this',
        occurrenceStart: '2026-09-23T09:30:00Z',
      });
      expect(res.statusCode).toBe(400);
    });

    it('scope "this"/"following" en un evento que no se repite da 400', async () => {
      const { id } = (await post({ ...daily5(), recurrence: undefined, title: 'Suelto' })).json();
      const res = await patch(id, {
        title: 'x',
        scope: 'this',
        occurrenceStart: '2026-09-21T08:00:00Z',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it('borrar la serie oculta todas las ocurrencias y restaurar las devuelve', async () => {
    const { id } = (await post(training())).json();
    await patch(id, { title: 'Entreno' });
    await app.inject({ method: 'DELETE', url: `/events/${id}` });
    expect(await list('2026-09-21T00:00:00Z', '2026-10-21T00:00:00Z')).toEqual([]);

    await app.inject({ method: 'POST', url: `/events/${id}/restore/2` });
    const back = await list('2026-09-21T00:00:00Z', '2026-10-05T00:00:00Z');
    expect(back).toHaveLength(4);
    expect(back[0]!.title).toBe('Entreno');
  });

  it('restaurar una versión anterior recupera también la regla anterior', async () => {
    const { id } = (await post(training())).json();
    await patch(id, { recurrence: { freq: 'daily', interval: 1 } });
    const res = await app.inject({ method: 'POST', url: `/events/${id}/restore/1` });
    expect(res.json().recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [0, 2] });
  });

  it('los filtros por calendario se aplican también a las series', async () => {
    const other = (
      await app.inject({ method: 'POST', url: '/calendars', payload: { name: 'Otro' } })
    ).json();
    await post(training());
    await post(training({ calendarId: other.id, title: 'En otro calendario' }));
    const filtered = await list(
      '2026-09-21T00:00:00Z',
      '2026-09-22T00:00:00Z',
      `&calendarId=${other.id}`,
    );
    expect(filtered.map((o) => o.title)).toEqual(['En otro calendario']);
  });

  it('una serie sin fin en un rango de un año responde rápido y con un tope razonable', async () => {
    await post(training({ recurrence: { freq: 'daily', interval: 1 } }));
    const started = Date.now();
    const occurrences = await list('2026-09-21T00:00:00Z', '2027-10-25T00:00:00Z');
    expect(occurrences.length).toBe(399);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
