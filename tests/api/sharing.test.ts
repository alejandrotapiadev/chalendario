import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { buildTestApp, signUp, type Client, type TestUser } from '../helpers/session.ts';

const range = '/events?from=2026-09-01T00:00:00Z&to=2026-12-31T00:00:00Z';

describe.skipIf(!testDatabaseUrl)('calendarios compartidos e invitaciones', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let server: FastifyInstance;
  let ana: TestUser; // propietaria
  let luis: TestUser;
  let marta: TestUser;
  let eva: TestUser; // ajena al calendario
  let calendarId: string;
  let eventId: string;

  beforeAll(() => resetDatabase(pool));
  afterAll(() => pool.end());
  beforeEach(async () => {
    await pool.query('TRUNCATE event_versions, events, calendars, categories, users CASCADE');
    server = await buildTestApp(pool);
    ana = await signUp(server, 'ana@example.com', 'Ana');
    luis = await signUp(server, 'luis@example.com', 'Luis');
    marta = await signUp(server, 'marta@example.com', 'Marta');
    eva = await signUp(server, 'eva@example.com', 'Eva');
    calendarId = ana.calendarId;
    eventId = (await createEvent(ana.client, { title: 'Cumple de Ana', reminders: [10] })).json()
      .id;
  });

  const event = (over: object = {}) => ({
    calendarId,
    title: 'Evento',
    startAt: '2026-10-05T08:00:00Z',
    endAt: '2026-10-05T09:00:00Z',
    timezone: 'Europe/Madrid',
    ...over,
  });
  const createEvent = (client: Client, over: object = {}) =>
    client.inject({ method: 'POST', url: '/events', payload: event(over) });
  const inviteUser = (
    email: string,
    role: 'viewer' | 'editor',
    client = ana.client,
    id = calendarId,
  ) => client.inject({ method: 'POST', url: `/calendars/${id}/members`, payload: { email, role } });
  const accept = (user: TestUser, id = calendarId) =>
    user.client.inject({ method: 'POST', url: `/invitations/${id}/accept` });
  /** Invita y acepta en un paso. */
  const share = async (user: TestUser, role: 'viewer' | 'editor') => {
    expect((await inviteUser(user.email, role)).statusCode).toBe(201);
    expect((await accept(user)).statusCode).toBe(204);
  };
  const titles = async (client: Client) =>
    ((await client.inject({ method: 'GET', url: range })).json() as { title: string }[]).map(
      (e) => e.title,
    );

  describe('invitar y aceptar', () => {
    it('la invitación queda pendiente y no da acceso hasta aceptarla', async () => {
      const res = await inviteUser('luis@example.com', 'editor');
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        userId: luis.userId,
        email: 'luis@example.com',
        name: 'Luis',
        role: 'editor',
        status: 'pending',
      });

      // Sin acceso todavía: no aparece el calendario ni se ven eventos.
      expect((await luis.client.inject({ method: 'GET', url: '/calendars' })).json()).toHaveLength(
        1,
      );
      expect(await titles(luis.client)).toEqual([]);
      expect(
        (await luis.client.inject({ method: 'GET', url: `/events/${eventId}` })).statusCode,
      ).toBe(404);
      expect(
        (await luis.client.inject({ method: 'GET', url: `/events/${eventId}/versions` }))
          .statusCode,
      ).toBe(404);
      expect((await createEvent(luis.client)).statusCode).toBe(404);

      // Y la ve como invitación pendiente.
      const invitations = (await luis.client.inject({ method: 'GET', url: '/invitations' })).json();
      expect(invitations).toEqual([
        expect.objectContaining({
          calendarId,
          calendarName: 'Personal',
          role: 'editor',
          invitedByName: 'Ana',
          invitedByEmail: 'ana@example.com',
        }),
      ]);
    });

    it('al aceptar aparece el calendario compartido con su papel y el nombre del propietario', async () => {
      await share(luis, 'viewer');
      const calendars = (await luis.client.inject({ method: 'GET', url: '/calendars' })).json();
      expect(calendars).toHaveLength(2);
      // Los propios primero.
      expect(calendars[0]).toMatchObject({ role: 'owner', ownerName: null });
      expect(calendars[1]).toMatchObject({ id: calendarId, role: 'viewer', ownerName: 'Ana' });
      expect((await luis.client.inject({ method: 'GET', url: '/invitations' })).json()).toEqual([]);
      expect(await titles(luis.client)).toEqual(['Cumple de Ana']);
    });

    it('rechazar borra la invitación (y se puede volver a invitar); aceptar dos veces da 404', async () => {
      await inviteUser('luis@example.com', 'viewer');
      expect(
        (await luis.client.inject({ method: 'POST', url: `/invitations/${calendarId}/decline` }))
          .statusCode,
      ).toBe(204);
      expect((await luis.client.inject({ method: 'GET', url: '/invitations' })).json()).toEqual([]);
      expect((await accept(luis)).statusCode).toBe(404);

      expect((await inviteUser('luis@example.com', 'editor')).statusCode).toBe(201);
      expect((await accept(luis)).statusCode).toBe(204);
      expect((await accept(luis)).statusCode).toBe(404);
    });

    it('no se puede aceptar la invitación de otro', async () => {
      await inviteUser('luis@example.com', 'editor');
      expect((await accept(marta)).statusCode).toBe(404);
      expect(
        (await eva.client.inject({ method: 'POST', url: `/invitations/${calendarId}/decline` }))
          .statusCode,
      ).toBe(404);
    });

    it('valida al invitar: email desconocido, uno mismo, repetido, rol y formato', async () => {
      const unknown = await inviteUser('nadie@example.com', 'viewer');
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error).toBe('user_not_found');

      const self = await inviteUser('ana@example.com', 'viewer');
      expect(self.statusCode).toBe(400);
      expect(self.json().error).toBe('cannot_invite_self');

      await inviteUser('luis@example.com', 'viewer');
      const twice = await inviteUser('LUIS@example.com', 'editor'); // sin distinguir mayúsculas
      expect(twice.statusCode).toBe(409);
      expect(twice.json().error).toBe('already_member');

      expect((await inviteUser('marta@example.com', 'admin' as 'viewer')).statusCode).toBe(400);
      expect((await inviteUser('no-es-email', 'viewer')).statusCode).toBe(400);
    });

    it('solo el propietario invita, y solo a sus propios calendarios', async () => {
      await share(luis, 'editor');
      // Un editor no puede invitar: el calendario «no existe» para la gestión de miembros.
      expect((await inviteUser('marta@example.com', 'viewer', luis.client)).statusCode).toBe(404);
      expect((await inviteUser('marta@example.com', 'viewer', eva.client)).statusCode).toBe(404);
    });
  });

  describe('lector', () => {
    beforeEach(() => share(luis, 'viewer'));

    it('puede leer: eventos, un evento, historial, búsqueda, recordatorios y exportar', async () => {
      const get = (url: string) => luis.client.inject({ method: 'GET', url });
      expect(await titles(luis.client)).toEqual(['Cumple de Ana']);
      expect((await get(`/events/${eventId}`)).json().title).toBe('Cumple de Ana');
      expect((await get(`/events/${eventId}/versions`)).statusCode).toBe(200);
      expect((await get(`/events/${eventId}/versions/1`)).statusCode).toBe(200);
      expect((await get('/events/search?q=cumple')).json()).toHaveLength(1);
      expect((await get(`/calendars/${calendarId}/export.ics`)).body).toContain(
        'SUMMARY:Cumple de Ana',
      );
      const reminders = (await get('/reminders/active?at=2026-10-05T07:55:00Z')).json();
      expect(reminders).toEqual([expect.objectContaining({ eventId, title: 'Cumple de Ana' })]);
    });

    it('no puede escribir: crear, editar, borrar, restaurar e importar dan 403', async () => {
      const forbidden = (res: { statusCode: number; json: () => { error: string } }) => {
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toBe('forbidden');
      };
      forbidden(await createEvent(luis.client));
      forbidden(
        await luis.client.inject({
          method: 'PATCH',
          url: `/events/${eventId}`,
          payload: { title: 'X' },
        }),
      );
      forbidden(await luis.client.inject({ method: 'DELETE', url: `/events/${eventId}` }));
      forbidden(await luis.client.inject({ method: 'POST', url: `/events/${eventId}/restore/1` }));
      forbidden(
        await luis.client.inject({
          method: 'POST',
          url: `/calendars/${calendarId}/import`,
          payload: { ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', timezone: 'Europe/Madrid' },
        }),
      );
      // Nada cambió.
      expect(
        (await ana.client.inject({ method: 'GET', url: `/events/${eventId}` })).json().version,
      ).toBe(1);
    });

    it('tampoco gestiona el calendario: ajustes, feed, suscripción y miembros dan 404', async () => {
      const inject = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
        luis.client.inject({ method, url, ...(payload && { payload }) });
      expect((await inject('PATCH', `/calendars/${calendarId}`, { name: 'Mío' })).statusCode).toBe(
        404,
      );
      expect((await inject('POST', `/calendars/${calendarId}/feed`)).statusCode).toBe(404);
      expect((await inject('GET', `/calendars/${calendarId}/feed`)).statusCode).toBe(404);
      expect((await inject('GET', `/calendars/${calendarId}/members`)).statusCode).toBe(404);
      expect(
        (
          await inject('PATCH', `/calendars/${calendarId}/members/${marta.userId}`, {
            role: 'editor',
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await inject('DELETE', `/calendars/${calendarId}/members/${marta.userId}`)).statusCode,
      ).toBe(404);
    });
  });

  describe('editor', () => {
    beforeEach(() => share(luis, 'editor'));

    it('puede crear, editar, borrar y restaurar eventos del calendario', async () => {
      const created = await createEvent(luis.client, { title: 'De Luis' });
      expect(created.statusCode).toBe(201);
      const id = created.json().id;
      expect(
        (
          await luis.client.inject({
            method: 'PATCH',
            url: `/events/${id}`,
            payload: { title: 'De Luis 2' },
          })
        ).json().version,
      ).toBe(2);
      expect(
        (
          await luis.client.inject({
            method: 'PATCH',
            url: `/events/${eventId}`,
            payload: { location: 'Sala' },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await luis.client.inject({ method: 'DELETE', url: `/events/${id}` })).statusCode,
      ).toBe(204);
      expect(
        (await luis.client.inject({ method: 'POST', url: `/events/${id}/restore/1` })).statusCode,
      ).toBe(200);
      // La propietaria ve lo que hizo el editor.
      expect((await titles(ana.client)).sort()).toEqual(['Cumple de Ana', 'De Luis']);
    });

    it('el historial dice quién hizo cada cambio', async () => {
      await ana.client.inject({
        method: 'PATCH',
        url: `/events/${eventId}`,
        payload: { title: 'v2 de Ana' },
      });
      await luis.client.inject({
        method: 'PATCH',
        url: `/events/${eventId}`,
        payload: { title: 'v3 de Luis' },
      });
      const versions = (
        await ana.client.inject({ method: 'GET', url: `/events/${eventId}/versions` })
      ).json();
      expect(
        versions.map((v: { version: number; author: string }) => [v.version, v.author]),
      ).toEqual([
        [3, 'Luis'],
        [2, 'Ana'],
        [1, 'Ana'],
      ]);
    });

    it('puede importar y exportar', async () => {
      const ics =
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x@y\r\nDTSTART:20261007T080000Z\r\nDTEND:20261007T090000Z\r\nSUMMARY:Importado por Luis\r\nEND:VEVENT\r\nEND:VCALENDAR';
      const res = await luis.client.inject({
        method: 'POST',
        url: `/calendars/${calendarId}/import`,
        payload: { ics, timezone: 'Europe/Madrid' },
      });
      expect(res.json()).toMatchObject({ created: 1 });
      expect(await titles(ana.client)).toContain('Importado por Luis');
    });

    it('usa sus propias categorías, no las de la propietaria', async () => {
      const mine = (
        await luis.client.inject({ method: 'POST', url: '/categories', payload: { name: 'Mía' } })
      ).json();
      const hers = (
        await ana.client.inject({ method: 'POST', url: '/categories', payload: { name: 'De Ana' } })
      ).json();
      expect((await createEvent(luis.client, { categoryId: mine.id })).statusCode).toBe(201);
      expect((await createEvent(luis.client, { categoryId: hers.id })).statusCode).toBe(404);
    });

    it('sigue sin poder gestionar el calendario: ajustes, feed y miembros dan 404', async () => {
      expect(
        (
          await luis.client.inject({
            method: 'PATCH',
            url: `/calendars/${calendarId}`,
            payload: { name: 'Mío' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await luis.client.inject({ method: 'POST', url: `/calendars/${calendarId}/feed` }))
          .statusCode,
      ).toBe(404);
      expect(
        (await luis.client.inject({ method: 'GET', url: `/calendars/${calendarId}/members` }))
          .statusCode,
      ).toBe(404);
    });

    it('la concurrencia sigue protegida: dos ediciones con la misma versión, una gana', async () => {
      const results = await Promise.all([
        ana.client.inject({
          method: 'PATCH',
          url: `/events/${eventId}`,
          payload: { title: 'A', expectedVersion: 1 },
        }),
        luis.client.inject({
          method: 'PATCH',
          url: `/events/${eventId}`,
          payload: { title: 'L', expectedVersion: 1 },
        }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    });
  });

  describe('quien no es miembro', () => {
    it('no ve ni toca nada del calendario', async () => {
      expect(await titles(eva.client)).toEqual([]);
      expect(
        (await eva.client.inject({ method: 'GET', url: `/events/${eventId}` })).statusCode,
      ).toBe(404);
      expect(
        (
          await eva.client.inject({
            method: 'PATCH',
            url: `/events/${eventId}`,
            payload: { title: 'X' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await eva.client.inject({ method: 'GET', url: '/events/search?q=cumple' })).json(),
      ).toEqual([]);
      expect(
        (await eva.client.inject({ method: 'GET', url: `/calendars/${calendarId}/export.ics` }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await eva.client.inject({
            method: 'GET',
            url: '/reminders/active?at=2026-10-05T07:55:00Z',
          })
        ).json(),
      ).toEqual([]);
      expect((await createEvent(eva.client)).statusCode).toBe(404);
    });
  });

  describe('gestionar miembros', () => {
    it('el propietario ve a todos, con su estado', async () => {
      await share(luis, 'editor');
      await inviteUser('marta@example.com', 'viewer');
      const members = (
        await ana.client.inject({ method: 'GET', url: `/calendars/${calendarId}/members` })
      ).json();
      expect(
        members.map((m: { name: string; role: string; status: string }) => [
          m.name,
          m.role,
          m.status,
        ]),
      ).toEqual([
        ['Luis', 'editor', 'accepted'],
        ['Marta', 'viewer', 'pending'],
      ]);
    });

    it('cambiar el papel tiene efecto inmediato', async () => {
      await share(luis, 'viewer');
      expect((await createEvent(luis.client)).statusCode).toBe(403);
      const res = await ana.client.inject({
        method: 'PATCH',
        url: `/calendars/${calendarId}/members/${luis.userId}`,
        payload: { role: 'editor' },
      });
      expect(res.json()).toMatchObject({ role: 'editor' });
      expect((await createEvent(luis.client)).statusCode).toBe(201);
      const back = await ana.client.inject({
        method: 'PATCH',
        url: `/calendars/${calendarId}/members/${luis.userId}`,
        payload: { role: 'viewer' },
      });
      expect(back.statusCode).toBe(200);
      expect((await createEvent(luis.client)).statusCode).toBe(403);
    });

    it('cambiar el papel de alguien que no es miembro da 404', async () => {
      const res = await ana.client.inject({
        method: 'PATCH',
        url: `/calendars/${calendarId}/members/${eva.userId}`,
        payload: { role: 'editor' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('quitar a un miembro le retira el acceso al instante', async () => {
      await share(luis, 'editor');
      expect(await titles(luis.client)).toEqual(['Cumple de Ana']);
      expect(
        (
          await ana.client.inject({
            method: 'DELETE',
            url: `/calendars/${calendarId}/members/${luis.userId}`,
          })
        ).statusCode,
      ).toBe(204);
      expect(await titles(luis.client)).toEqual([]);
      expect((await luis.client.inject({ method: 'GET', url: '/calendars' })).json()).toHaveLength(
        1,
      );
      expect((await createEvent(luis.client)).statusCode).toBe(404);
      // Lo que aportó mientras tanto se queda en el calendario.
    });

    it('un miembro puede salir por su cuenta, pero no echar a otros', async () => {
      await share(luis, 'editor');
      await share(marta, 'viewer');
      const kick = await luis.client.inject({
        method: 'DELETE',
        url: `/calendars/${calendarId}/members/${marta.userId}`,
      });
      expect(kick.statusCode).toBe(404);
      expect(
        (
          await luis.client.inject({
            method: 'DELETE',
            url: `/calendars/${calendarId}/members/${luis.userId}`,
          })
        ).statusCode,
      ).toBe(204);
      expect(await titles(luis.client)).toEqual([]);
      expect(await titles(marta.client)).toEqual(['Cumple de Ana']);
    });

    it('lo que un editor creó se conserva cuando deja de tener acceso', async () => {
      await share(luis, 'editor');
      await createEvent(luis.client, { title: 'Aportación de Luis' });
      await ana.client.inject({
        method: 'DELETE',
        url: `/calendars/${calendarId}/members/${luis.userId}`,
      });
      expect(await titles(ana.client)).toContain('Aportación de Luis');
    });
  });

  it('un calendario suscrito a una URL sigue siendo de solo lectura aunque se comparta como editor', async () => {
    const ics =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:h@g\r\nDTSTART:20261007T080000Z\r\nDTEND:20261007T090000Z\r\nSUMMARY:Festivo\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const shared = await buildTestApp(pool, { fetchIcs: async () => ics });
    const owner = await signUp(shared, 'owner2@example.com', 'Owner');
    const editor = await signUp(shared, 'editor2@example.com', 'Editor');
    const sub = (
      await owner.client.inject({
        method: 'POST',
        url: '/subscriptions',
        payload: { name: 'Festivos', url: 'https://example.com/x.ics', timezone: 'Europe/Madrid' },
      })
    ).json().calendar;
    await owner.client.inject({
      method: 'POST',
      url: `/calendars/${sub.id}/members`,
      payload: { email: editor.email, role: 'editor' },
    });
    await editor.client.inject({ method: 'POST', url: `/invitations/${sub.id}/accept` });

    expect(await titles(editor.client)).toEqual(['Festivo']);
    const res = await editor.client.inject({
      method: 'POST',
      url: '/events',
      payload: event({ calendarId: sub.id }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('calendar_read_only');
  });

  it('el feed público sigue funcionando para calendarios compartidos', async () => {
    await share(luis, 'viewer');
    const path = (
      await ana.client.inject({ method: 'POST', url: `/calendars/${calendarId}/feed` })
    ).json().path;
    expect((await server.inject({ method: 'GET', url: path })).body).toContain('Cumple de Ana');
  });
});
