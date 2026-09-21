import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { redactFeedToken } from '../../apps/api/src/modules/interop/interop.routes.ts';
import { syncDueSubscriptions } from '../../apps/api/src/modules/interop/interop.service.ts';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import {
  buildTestApp,
  signUp,
  withCookie,
  type Client,
  type TestUser,
} from '../helpers/session.ts';

const TZ = 'Europe/Madrid';

const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (
  uid: string,
  title: string,
  start = '20261005T080000Z',
  end = '20261005T090000Z',
  extra: string[] = [],
) =>
  [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    ...extra,
    'END:VEVENT',
  ].join('\r\n');

interface Listed {
  id: string;
  title: string;
  startAt: string;
  recurrence: unknown;
  reminders: number[];
  categoryId: string | null;
  allDay: boolean;
}

describe.skipIf(!testDatabaseUrl)('interoperabilidad (ICS, feed y suscripciones)', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let server: FastifyInstance;
  let user: TestUser;
  let app: Client;
  let calendarId: string;
  let remote = '';
  const fetchIcs = vi.fn(async (_url: string) => remote);

  beforeAll(() => resetDatabase(pool));
  afterAll(() => pool.end());
  beforeEach(async () => {
    await pool.query('TRUNCATE event_versions, events, calendars, categories, users CASCADE');
    fetchIcs.mockClear();
    fetchIcs.mockImplementation(async () => remote);
    server = await buildTestApp(pool, { fetchIcs });
    user = await signUp(server);
    app = user.client;
    calendarId = user.calendarId;
  });

  const range = '/events?from=2026-09-01T00:00:00Z&to=2026-12-31T00:00:00Z';
  const events = async (client = app): Promise<Listed[]> =>
    (await client.inject({ method: 'GET', url: range })).json();
  const post = (payload: object, client = app) =>
    client.inject({ method: 'POST', url: '/events', payload });
  const importInto = (id: string, ics: string, client = app, timezone = TZ) =>
    client.inject({ method: 'POST', url: `/calendars/${id}/import`, payload: { ics, timezone } });
  const exportOf = (id: string, client = app) =>
    client.inject({ method: 'GET', url: `/calendars/${id}/export.ics` });
  const newCalendar = async (name: string, client = app) =>
    (await client.inject({ method: 'POST', url: '/calendars', payload: { name } })).json();
  const versionsOf = async (id: string) =>
    (await app.inject({ method: 'GET', url: `/events/${id}/versions` })).json();
  const madridEvent = (over: object = {}) => ({
    calendarId,
    title: 'Gym',
    startAt: '2026-10-05T08:00:00Z',
    endAt: '2026-10-05T09:00:00Z',
    timezone: TZ,
    ...over,
  });

  describe('exportar', () => {
    it('devuelve un .ics descargable con los eventos del calendario', async () => {
      await post(madridEvent({ title: 'Cena, con amigos', location: 'Sala 2' }));
      await post(
        madridEvent({
          title: 'Todo el día',
          allDay: true,
          startAt: '2026-10-05T22:00:00Z',
          endAt: '2026-10-06T22:00:00Z',
        }),
      );
      await post(
        madridEvent({
          title: 'Serie',
          recurrence: { freq: 'weekly', interval: 1, byWeekday: [0], count: 3 },
        }),
      );

      const res = await exportOf(calendarId);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="Personal.ics"');
      expect(res.body).toContain('SUMMARY:Cena\\, con amigos');
      expect(res.body).toContain('DTSTART;VALUE=DATE:20261006');
      expect(res.body).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3');
      expect(res.body.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    });

    it('no incluye los borrados y usa un nombre de fichero seguro', async () => {
      const cal2 = await newCalendar('Vacaciones ñandú / 2026');
      const { id } = (await post(madridEvent({ calendarId: cal2.id }))).json();
      await app.inject({ method: 'DELETE', url: `/events/${id}` });
      const res = await exportOf(cal2.id);
      expect(res.body).not.toContain('BEGIN:VEVENT');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="Vacaciones-nandu-2026.ics"',
      );
    });

    it('un calendario ajeno o inexistente da 404', async () => {
      const other = (await signUp(server)).client;
      expect((await exportOf(calendarId, other)).statusCode).toBe(404);
    });
  });

  describe('importar', () => {
    it('crea los eventos, con versión y motivo «import» en el historial', async () => {
      const res = await importInto(
        calendarId,
        cal(ev('a@x', 'Reunión'), ev('b@x', 'Comida', '20261006T100000Z', '20261006T110000Z')),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        created: 2,
        updated: 0,
        unchanged: 0,
        removed: 0,
        skipped: [],
        warnings: [],
      });

      const listed = await events();
      expect(listed.map((e) => e.title)).toEqual(['Reunión', 'Comida']);
      const versions = await versionsOf(listed[0]!.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].changeReason).toBe('import');
    });

    it('importar dos veces el mismo fichero no duplica: la segunda no toca nada', async () => {
      const file = cal(ev('a@x', 'Reunión'), ev('b@x', 'Comida'));
      await importInto(calendarId, file);
      const second = await importInto(calendarId, file);
      expect(second.json()).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
      const listed = await events();
      expect(listed).toHaveLength(2);
      expect(await versionsOf(listed[0]!.id)).toHaveLength(1);
    });

    it('si un evento cambia en el fichero, añade una versión y se puede deshacer', async () => {
      await importInto(calendarId, cal(ev('a@x', 'Reunión')));
      const before = (await events())[0]!;
      const res = await importInto(
        calendarId,
        cal(ev('a@x', 'Reunión (aplazada)', '20261007T080000Z', '20261007T090000Z')),
      );
      expect(res.json()).toMatchObject({ created: 0, updated: 1 });

      const after = (await events())[0]!;
      expect(after.id).toBe(before.id);
      expect(after.title).toBe('Reunión (aplazada)');
      const versions = await versionsOf(after.id);
      expect(versions).toHaveLength(2);
      expect(versions[0].changeReason).toBe('import');

      const restored = await app.inject({ method: 'POST', url: `/events/${after.id}/restore/1` });
      expect(restored.json().title).toBe('Reunión');
    });

    it('un evento borrado en la app y presente en el fichero vuelve a aparecer', async () => {
      await importInto(calendarId, cal(ev('a@x', 'Reunión')));
      const { id } = (await events())[0]!;
      await app.inject({ method: 'DELETE', url: `/events/${id}` });
      expect(await events()).toEqual([]);
      const res = await importInto(calendarId, cal(ev('a@x', 'Reunión')));
      expect(res.json()).toMatchObject({ created: 0, updated: 1 });
      expect((await events())[0]!.id).toBe(id);
    });

    it('importar un evento sin UID no duplica al repetir la importación', async () => {
      const noUid = cal(
        'BEGIN:VEVENT',
        'DTSTART:20261005T080000Z',
        'DTEND:20261005T090000Z',
        'SUMMARY:Sin UID',
        'END:VEVENT',
      );
      await importInto(calendarId, noUid);
      expect((await importInto(calendarId, noUid)).json()).toMatchObject({
        created: 0,
        unchanged: 1,
      });
    });

    it('lee avisos, repetición y todo el día, y avisa de lo que no se soporta', async () => {
      const file = cal(
        ev('r@x', 'Serie', '20261005T080000Z', '20261005T090000Z', [
          'RRULE:FREQ=WEEKLY;COUNT=3',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT15M',
          'END:VALARM',
        ]),
        ev('u@x', 'Rara', '20261006T080000Z', '20261006T090000Z', ['RRULE:FREQ=MONTHLY;BYDAY=2TU']),
        [
          'BEGIN:VEVENT',
          'UID:d@x',
          'DTSTART;VALUE=DATE:20261010',
          'DTEND;VALUE=DATE:20261012',
          'SUMMARY:Fin de semana',
          'END:VEVENT',
        ].join('\r\n'),
      );
      const res = await importInto(calendarId, file);
      expect(res.json()).toMatchObject({ created: 3 });
      expect(res.json().warnings.join(' ')).toMatch(/«Rara».*no soportada/);

      const listed = await events();
      const serie = listed.find((e) => e.title === 'Serie')!;
      expect(serie.reminders).toEqual([15]);
      expect(serie.recurrence).toMatchObject({ freq: 'weekly', count: 3 });
      expect(listed.find((e) => e.title === 'Rara')!.recurrence).toBeNull();
      const allDay = listed.find((e) => e.title === 'Fin de semana')!;
      expect(allDay.allDay).toBe(true);
      expect(allDay.startAt).toBe('2026-10-09T22:00:00.000Z'); // 10 oct 00:00 en Madrid
    });

    it('omite con motivo los eventos inválidos y sigue con el resto', async () => {
      const file = cal(
        ev('ok@x', 'Buena'),
        ['BEGIN:VEVENT', 'UID:mal@x', 'SUMMARY:Sin inicio', 'END:VEVENT'].join('\r\n'),
        ev('r@x', 'Serie rota', '20261005T080000Z', '20261005T090000Z', [
          'RRULE:FREQ=DAILY;UNTIL=20200101',
        ]),
      );
      const res = await importInto(calendarId, file);
      expect(res.json()).toMatchObject({ created: 1 });
      expect(res.json().skipped.map((s: { title: string }) => s.title)).toEqual([
        'Sin inicio',
        'Serie rota',
      ]);
      expect(res.json().skipped[1].reason).toMatch(/anterior/);
    });

    it('asigna la categoría por nombre y avisa de las que no existen', async () => {
      const salud = (
        await app.inject({ method: 'POST', url: '/categories', payload: { name: 'Salud' } })
      ).json();
      await importInto(
        calendarId,
        cal(
          ev('a@x', 'Dentista', '20261005T080000Z', '20261005T090000Z', ['CATEGORIES:salud']),
          ev('b@x', 'Otro', '20261006T080000Z', '20261006T090000Z', ['CATEGORIES:Inventada']),
        ),
      );
      const listed = await events();
      expect(listed.find((e) => e.title === 'Dentista')!.categoryId).toBe(salud.id);
      expect(listed.find((e) => e.title === 'Otro')!.categoryId).toBeNull();
      // La segunda importación conserva la categoría aunque el fichero ya no la traiga.
      const res = await importInto(
        calendarId,
        cal(ev('a@x', 'Dentista', '20261005T080000Z', '20261005T090000Z')),
      );
      expect(res.json()).toMatchObject({ unchanged: 1 });
      expect((await events()).find((e) => e.title === 'Dentista')!.categoryId).toBe(salud.id);
      const unknown = await importInto(
        calendarId,
        cal(ev('b@x', 'Otro', '20261006T080000Z', '20261006T090000Z', ['CATEGORIES:Inventada'])),
      );
      expect(unknown.json().warnings.join(' ')).toContain('Inventada');
    });

    it('un UID repetido dentro del fichero se omite', async () => {
      const res = await importInto(calendarId, cal(ev('a@x', 'Primero'), ev('a@x', 'Segundo')));
      expect(res.json()).toMatchObject({ created: 1 });
      expect(res.json().skipped).toEqual([
        { title: 'Segundo', reason: 'UID repetido en el fichero' },
      ]);
    });

    it.each([
      ['no es un calendario', { ics: 'hola', timezone: TZ }, 400, 'invalid_ics'],
      [
        'zona horaria desconocida',
        { ics: cal(ev('a@x', 'X')), timezone: 'Marte/Olimpo' },
        400,
        'invalid_timezone',
      ],
      ['fichero vacío', { ics: '', timezone: TZ }, 400, 'validation_error'],
      ['campo desconocido', { ics: cal(), timezone: TZ, foo: 1 }, 400, 'validation_error'],
    ])('rechaza %s', async (_name, payload, status, code) => {
      const res = await app.inject({
        method: 'POST',
        url: `/calendars/${calendarId}/import`,
        payload,
      });
      expect(res.statusCode).toBe(status);
      expect(res.json().error).toBe(code);
    });

    it('no importa en calendarios ajenos', async () => {
      const other = (await signUp(server)).client;
      expect((await importInto(calendarId, cal(ev('a@x', 'X')), other)).statusCode).toBe(404);
      expect(await events()).toEqual([]);
    });

    it('un fichero de más de 1 MiB llega (el límite del cuerpo es mayor)', async () => {
      const big = cal(
        ev('a@x', 'Grande', '20261005T080000Z', '20261005T090000Z', [
          `DESCRIPTION:${'x'.repeat(1_200_000)}`,
        ]),
      );
      // La descripción supera el máximo del dominio (10 000): el evento se omite, pero el fichero se procesa.
      const res = await importInto(calendarId, big);
      expect(res.statusCode).toBe(200);
      expect(res.json().skipped).toHaveLength(1);
    });
  });

  describe('ciclo exportar → importar', () => {
    it('reproduce los eventos en otro calendario con las mismas fechas, series, avisos y categorías', async () => {
      const salud = (
        await app.inject({ method: 'POST', url: '/categories', payload: { name: 'Salud' } })
      ).json();
      await post(
        madridEvent({
          title: 'Dentista',
          categoryId: salud.id,
          reminders: [10, 1440],
          location: 'Alcobendas',
        }),
      );
      await post(
        madridEvent({
          title: 'Yoga',
          startAt: '2026-10-05T16:00:00Z',
          endAt: '2026-10-05T17:00:00Z',
          recurrence: { freq: 'weekly', interval: 2, byWeekday: [0, 2], count: 4 },
        }),
      );
      await post(
        madridEvent({
          title: 'Escapada',
          allDay: true,
          startAt: '2026-10-09T22:00:00Z',
          endAt: '2026-10-11T22:00:00Z',
        }),
      );

      const file = (await exportOf(calendarId)).body;
      const target = await newCalendar('Copia');
      const res = await importInto(target.id, file);
      expect(res.json()).toMatchObject({ created: 3, skipped: [], warnings: [] });

      const all = (await app.inject({ method: 'GET', url: range })).json() as (Listed & {
        calendarId: string;
      })[];
      const source = all
        .filter((e) => e.calendarId === calendarId)
        .sort((a, b) => a.title.localeCompare(b.title));
      const copy = all
        .filter((e) => e.calendarId === target.id)
        .sort((a, b) => a.title.localeCompare(b.title));
      expect(copy).toHaveLength(source.length);
      expect(source.length).toBeGreaterThan(3); // la serie se expande en varias ocurrencias
      for (const [i, original] of source.entries()) {
        expect(copy[i]).toMatchObject({
          title: original.title,
          startAt: original.startAt,
          recurrence: original.recurrence,
          reminders: original.reminders,
          categoryId: original.categoryId,
          allDay: original.allDay,
        });
      }
    });

    it('reimportar el propio fichero exportado en el mismo calendario no cambia nada', async () => {
      await post(madridEvent());
      await post(
        madridEvent({ title: 'Otro', recurrence: { freq: 'daily', interval: 1, count: 2 } }),
      );
      const before = await events();
      const res = await importInto(calendarId, (await exportOf(calendarId)).body);
      expect(res.json()).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
      expect(await events()).toEqual(before);
    });
  });

  describe('enlace de suscripción (feed)', () => {
    const feedOf = async (id = calendarId, client = app) =>
      (await client.inject({ method: 'POST', url: `/calendars/${id}/feed` })).json().path as string;
    const publicGet = (path: string, headers: Record<string, string> = {}) =>
      server.inject({ method: 'GET', url: path, headers });

    it('está desactivado hasta que se crea, y crearlo devuelve una ruta pública con token', async () => {
      expect(
        (await app.inject({ method: 'GET', url: `/calendars/${calendarId}/feed` })).json(),
      ).toEqual({ enabled: false, createdAt: null });
      const created = await app.inject({ method: 'POST', url: `/calendars/${calendarId}/feed` });
      expect(created.statusCode).toBe(201);
      expect(created.json().path).toMatch(/^\/feeds\/[A-Za-z0-9_-]{43}\.ics$/);
      expect(
        (await app.inject({ method: 'GET', url: `/calendars/${calendarId}/feed` })).json().enabled,
      ).toBe(true);
    });

    it('se lee sin sesión y solo guarda el hash del token', async () => {
      await post(madridEvent({ title: 'Visible en el feed' }));
      const path = await feedOf();
      const res = await publicGet(path);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
      expect(res.body).toContain('SUMMARY:Visible en el feed');

      const token = path.slice('/feeds/'.length, -'.ics'.length);
      const { rows } = await pool.query('SELECT token_hash FROM calendar_feeds');
      expect(rows[0].token_hash).not.toBe(token);
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('ETag: 304 si no cambió y un contenido distinto cuando cambian los eventos', async () => {
      await post(madridEvent());
      const path = await feedOf();
      const first = await publicGet(path);
      const etag = first.headers.etag as string;
      expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
      expect((await publicGet(path, { 'if-none-match': etag })).statusCode).toBe(304);

      await post(madridEvent({ title: 'Nuevo' }));
      const changed = await publicGet(path, { 'if-none-match': etag });
      expect(changed.statusCode).toBe(200);
      expect(changed.headers.etag).not.toBe(etag);
    });

    it('regenerar invalida el enlace anterior; revocar lo desactiva', async () => {
      const oldPath = await feedOf();
      const newPath = await feedOf();
      expect(newPath).not.toBe(oldPath);
      expect((await publicGet(oldPath)).statusCode).toBe(404);
      expect((await publicGet(newPath)).statusCode).toBe(200);

      expect(
        (await app.inject({ method: 'DELETE', url: `/calendars/${calendarId}/feed` })).statusCode,
      ).toBe(204);
      expect((await publicGet(newPath)).statusCode).toBe(404);
    });

    it.each([['inventado.ics'], ['a'.repeat(43) + '.ics'], ['a'.repeat(43)], ['../../etc/passwd']])(
      'token inválido «%s» da 404',
      async (file) => {
        expect((await publicGet(`/feeds/${file}`)).statusCode).toBe(404);
      },
    );

    it('otro usuario no puede crear ni ver el estado del enlace', async () => {
      const other = (await signUp(server)).client;
      expect(
        (await other.inject({ method: 'POST', url: `/calendars/${calendarId}/feed` })).statusCode,
      ).toBe(404);
      expect(
        (await other.inject({ method: 'GET', url: `/calendars/${calendarId}/feed` })).statusCode,
      ).toBe(404);
      expect(
        (await other.inject({ method: 'DELETE', url: `/calendars/${calendarId}/feed` })).statusCode,
      ).toBe(404);
    });

    it('el token no aparece en los logs de peticiones', () => {
      expect(redactFeedToken('/feeds/abc123_-XYZ.ics?x=1')).toBe('/feeds/[redacted]?x=1');
      expect(redactFeedToken('/calendars/1/feed')).toBe('/calendars/1/feed');
    });
  });

  describe('suscripción a una URL externa', () => {
    const subscribe = (payload: object, client = app) =>
      client.inject({ method: 'POST', url: '/subscriptions', payload });
    const body = (over: object = {}) => ({
      name: 'Festivos',
      url: 'https://calendar.example.com/es.ics',
      timezone: TZ,
      ...over,
    });
    const sync = (id: string, client = app) =>
      client.inject({ method: 'POST', url: `/calendars/${id}/sync` });
    const calendars = async (client = app) =>
      (await client.inject({ method: 'GET', url: '/calendars' })).json();

    it('crea un calendario con los eventos del origen y solo expone el dominio', async () => {
      remote = cal(
        ev('h1@g', 'Festivo 1'),
        ev('h2@g', 'Festivo 2', '20261006T080000Z', '20261006T090000Z'),
      );
      const res = await subscribe(
        body({ url: 'webcal://calendar.example.com/secret-path/es.ics', color: '#ef4444' }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().result).toMatchObject({ created: 2 });
      expect(res.json().calendar).toMatchObject({
        name: 'Festivos',
        color: '#ef4444',
        subscription: { host: 'calendar.example.com', lastError: null },
      });
      expect(JSON.stringify(res.json())).not.toContain('secret-path');
      expect(fetchIcs).toHaveBeenCalledWith('https://calendar.example.com/secret-path/es.ics');
      expect(await events()).toHaveLength(2);
    });

    it.each([
      ['http://example.com/x.ics', 'unsafe_url'],
      ['https://127.0.0.1/x.ics', 'unsafe_url'],
      ['no es una url', 'unsafe_url'],
    ])('rechaza la URL %s sin descargar nada', async (url, code) => {
      const res = await subscribe(body({ url }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe(code);
      expect(fetchIcs).not.toHaveBeenCalled();
      expect(await calendars()).toHaveLength(1);
    });

    it('si la descarga falla o el fichero no es válido, no se crea el calendario', async () => {
      fetchIcs.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:443'));
      const failed = await subscribe(body());
      expect(failed.statusCode).toBe(502);
      expect(failed.json().message).not.toContain('10.0.0.5'); // no se filtran detalles de red

      remote = 'esto no es un calendario';
      expect((await subscribe(body())).json().error).toBe('invalid_ics');
      expect(await calendars()).toHaveLength(1);
    });

    describe('con una suscripción activa', () => {
      let subId: string;
      beforeEach(async () => {
        remote = cal(
          ev('h1@g', 'Festivo 1'),
          ev('h2@g', 'Festivo 2', '20261006T080000Z', '20261006T090000Z'),
        );
        subId = (await subscribe(body())).json().calendar.id;
      });

      it('sus eventos son de solo lectura: crear, editar, borrar y restaurar dan 409', async () => {
        const first = (await events())[0]!;
        const readOnly = (res: { statusCode: number; json: () => { error: string } }) => {
          expect(res.statusCode).toBe(409);
          expect(res.json().error).toBe('calendar_read_only');
        };
        readOnly(await post(madridEvent({ calendarId: subId })));
        readOnly(
          await app.inject({
            method: 'PATCH',
            url: `/events/${first.id}`,
            payload: { title: 'X' },
          }),
        );
        readOnly(await app.inject({ method: 'DELETE', url: `/events/${first.id}` }));
        readOnly(await app.inject({ method: 'POST', url: `/events/${first.id}/restore/1` }));
        readOnly(await importInto(subId, cal(ev('z@x', 'Z'))));
      });

      it('sincronizar crea, actualiza y borra para dejar el calendario igual que el origen', async () => {
        remote = cal(
          ev('h1@g', 'Festivo 1 (cambiado)'),
          ev('h3@g', 'Festivo 3', '20261007T080000Z', '20261007T090000Z'),
        );
        const res = await sync(subId);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ created: 1, updated: 1, removed: 1, unchanged: 0 });

        const titles = (await events()).map((e) => e.title);
        expect(titles).toEqual(['Festivo 1 (cambiado)', 'Festivo 3']);

        // El historial deja constancia de la sincronización.
        const changed = (await events())[0]!;
        expect((await versionsOf(changed.id))[0].changeReason).toBe('sync');
      });

      it('sin cambios en el origen no toca nada', async () => {
        const res = await sync(subId);
        expect(res.json()).toMatchObject({ created: 0, updated: 0, removed: 0, unchanged: 2 });
      });

      it('un evento que desaparece y vuelve a aparecer se recupera', async () => {
        remote = cal(ev('h1@g', 'Festivo 1'));
        await sync(subId);
        expect(await events()).toHaveLength(1);
        remote = cal(
          ev('h1@g', 'Festivo 1'),
          ev('h2@g', 'Festivo 2', '20261006T080000Z', '20261006T090000Z'),
        );
        expect((await sync(subId)).json()).toMatchObject({ updated: 1 });
        expect(await events()).toHaveLength(2);
      });

      it('un fallo se anota en el calendario y no toca los eventos; el siguiente éxito lo limpia', async () => {
        fetchIcs.mockRejectedValueOnce(new Error('El servidor respondió 503'));
        const failed = await sync(subId);
        expect(failed.statusCode).toBe(502);
        expect(failed.json().message).toBe('El servidor respondió 503');
        expect(await events()).toHaveLength(2);
        expect(
          (await calendars()).find((c: { id: string }) => c.id === subId).subscription.lastError,
        ).toBe('El servidor respondió 503');

        await sync(subId);
        expect(
          (await calendars()).find((c: { id: string }) => c.id === subId).subscription.lastError,
        ).toBeNull();
      });

      it('dos sincronizaciones a la vez: la segunda recibe 409 en vez de duplicar', async () => {
        const holder = await pool.connect();
        try {
          await holder.query('SELECT pg_advisory_lock(hashtext($1))', [`sync:${subId}`]);
          const blocked = await sync(subId);
          expect(blocked.statusCode).toBe(409);
          expect(blocked.json().error).toBe('sync_in_progress');
        } finally {
          await holder.query('SELECT pg_advisory_unlock_all()');
          holder.release();
        }
        expect((await sync(subId)).statusCode).toBe(200);
      });

      it('dejar de sincronizar conserva los eventos y vuelve a permitir editarlos', async () => {
        expect(
          (await app.inject({ method: 'DELETE', url: `/calendars/${subId}/subscription` }))
            .statusCode,
        ).toBe(204);
        expect(
          (await calendars()).find((c: { id: string }) => c.id === subId).subscription,
        ).toBeNull();
        expect(await events()).toHaveLength(2);
        expect((await post(madridEvent({ calendarId: subId }))).statusCode).toBe(201);
        expect((await sync(subId)).statusCode).toBe(404);
        expect(
          (await app.inject({ method: 'DELETE', url: `/calendars/${subId}/subscription` }))
            .statusCode,
        ).toBe(404);
      });

      it('otro usuario no puede sincronizar ni cancelar la suscripción', async () => {
        const other = (await signUp(server)).client;
        expect((await sync(subId, other)).statusCode).toBe(404);
        expect(
          (await other.inject({ method: 'DELETE', url: `/calendars/${subId}/subscription` }))
            .statusCode,
        ).toBe(404);
      });

      it('la sincronización periódica solo toca las suscripciones cuyo último intento es antiguo', async () => {
        fetchIcs.mockClear();
        // Acaba de sincronizarse al suscribirse: no toca.
        expect(await syncDueSubscriptions(pool, fetchIcs, { minAgeMs: 30 * 60_000 })).toBe(0);
        expect(fetchIcs).not.toHaveBeenCalled();

        await pool.query(
          "UPDATE calendar_subscriptions SET last_attempt_at = now() - interval '1 hour'",
        );
        remote = cal(ev('h1@g', 'Festivo 1'));
        expect(await syncDueSubscriptions(pool, fetchIcs, { minAgeMs: 30 * 60_000 })).toBe(1);
        expect(await events()).toHaveLength(1);
      });

      it('un fallo en una suscripción no impide sincronizar las demás', async () => {
        remote = cal(ev('o1@g', 'Otro origen'));
        const second = (
          await subscribe(body({ name: 'Segundo', url: 'https://calendar.example.com/otro.ics' }))
        ).json().calendar.id;
        await pool.query(
          "UPDATE calendar_subscriptions SET last_attempt_at = now() - interval '1 hour'",
        );
        fetchIcs.mockImplementation(async (url) => {
          if (url.endsWith('/es.ics')) throw new Error('caído');
          return cal(
            ev('o1@g', 'Otro origen'),
            ev('o2@g', 'Otro más', '20261008T080000Z', '20261008T090000Z'),
          );
        });
        const failures: string[] = [];
        const synced = await syncDueSubscriptions(pool, fetchIcs, {
          minAgeMs: 1000,
          onError: (id) => failures.push(id),
        });
        expect(synced).toBe(1);
        expect(failures).toEqual([subId]);
        expect((await events()).filter((e) => e.title.startsWith('Otro'))).toHaveLength(2);
        void second;
      });
    });

    it('otro usuario no ve el calendario suscrito ni sus eventos', async () => {
      remote = cal(ev('h1@g', 'Festivo 1'));
      await subscribe(body());
      const other = (await signUp(server)).client;
      expect(await calendars(other)).toHaveLength(1); // solo su «Personal»
      expect(await events(other)).toEqual([]);
    });
  });

  it('las rutas de interoperabilidad exigen sesión (salvo el feed público)', async () => {
    const anonymous = withCookie(server, 'sid=nope');
    for (const [method, url] of [
      ['GET', `/calendars/${calendarId}/export.ics`],
      ['POST', `/calendars/${calendarId}/import`],
      ['POST', '/subscriptions'],
      ['POST', `/calendars/${calendarId}/sync`],
      ['POST', `/calendars/${calendarId}/feed`],
    ] as const) {
      expect((await anonymous.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
