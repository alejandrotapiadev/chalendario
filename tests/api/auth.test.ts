import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabaseUrl } from '../helpers/db.ts';
import { TEST_PASSWORD, buildTestApp, signUp, withCookie } from '../helpers/session.ts';

describe.skipIf(!testDatabaseUrl)('autenticación', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let app: FastifyInstance;

  beforeAll(() => resetDatabase(pool));
  afterAll(() => pool.end());
  beforeEach(async () => {
    await pool.query('TRUNCATE event_versions, events, calendars, users CASCADE');
    app = await buildTestApp(pool);
  });

  const register = (payload: object) =>
    app.inject({ method: 'POST', url: '/auth/register', payload });
  const login = (payload: object) => app.inject({ method: 'POST', url: '/auth/login', payload });
  const valid = { email: 'ana@example.com', password: TEST_PASSWORD, name: 'Ana' };

  describe('registro', () => {
    it('crea la cuenta, un calendario «Personal» y abre sesión con una cookie httpOnly', async () => {
      const res = await register(valid);
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
      expect(res.json()).not.toHaveProperty('password_hash');

      const cookie = res.cookies.find((c) => c.name === 'sid')!;
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

      const me = await withCookie(app, `sid=${cookie.value}`).inject({
        method: 'GET',
        url: '/auth/me',
      });
      expect(me.json()).toMatchObject({ email: 'ana@example.com' });
      const calendars = await withCookie(app, `sid=${cookie.value}`).inject({
        method: 'GET',
        url: '/calendars',
      });
      expect(calendars.json()).toMatchObject([{ name: 'Personal' }]);
    });

    it('guarda un hash de la contraseña y solo el hash del token de sesión', async () => {
      const res = await register(valid);
      const token = res.cookies.find((c) => c.name === 'sid')!.value;
      const { rows } = await pool.query('SELECT password_hash FROM users');
      expect(rows[0].password_hash).toMatch(/^scrypt\$/);
      expect(rows[0].password_hash).not.toContain(TEST_PASSWORD);
      const sessions = await pool.query('SELECT token_hash FROM sessions');
      expect(sessions.rows[0].token_hash).not.toBe(token);
    });

    it('rechaza emails repetidos (sin distinguir mayúsculas) con 409', async () => {
      await register(valid);
      const again = await register({ ...valid, email: 'ANA@example.com' });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('email_taken');
    });

    it.each([
      ['contraseña corta', { password: 'short' }],
      ['email inválido', { email: 'no-es-un-email' }],
      ['nombre vacío', { name: '  ' }],
      ['campo desconocido', { admin: true }],
    ])('rechaza %s con 400', async (_name, override) => {
      expect((await register({ ...valid, ...override })).statusCode).toBe(400);
    });

    it('responde 403 si el registro está cerrado', async () => {
      const closed = await buildTestApp(pool, { registrationOpen: false });
      const res = await closed.inject({ method: 'POST', url: '/auth/register', payload: valid });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('registration_closed');
    });
  });

  describe('inicio y cierre de sesión', () => {
    it('inicia sesión con credenciales correctas (email sin distinguir mayúsculas)', async () => {
      await register(valid);
      const res = await login({ email: 'ANA@example.com', password: TEST_PASSWORD });
      expect(res.statusCode).toBe(200);
      const token = res.cookies.find((c) => c.name === 'sid')!.value;
      const me = await withCookie(app, `sid=${token}`).inject({ method: 'GET', url: '/auth/me' });
      expect(me.statusCode).toBe(200);
    });

    it('da el mismo 401 genérico con contraseña incorrecta y con email inexistente', async () => {
      await register(valid);
      const wrongPassword = await login({ email: valid.email, password: 'incorrecta-123' });
      const unknownEmail = await login({ email: 'nadie@example.com', password: TEST_PASSWORD });
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.json()).toEqual(unknownEmail.json());
      expect(wrongPassword.cookies).toEqual([]);
    });

    it('una cuenta sin contraseña (creada antes de la autenticación) no puede iniciar sesión', async () => {
      await pool.query("INSERT INTO users (email, name) VALUES ('viejo@example.com', 'Viejo')");
      expect(
        (await login({ email: 'viejo@example.com', password: TEST_PASSWORD })).statusCode,
      ).toBe(401);
    });

    it('cerrar sesión invalida la sesión y borra la cookie', async () => {
      const { client, cookie } = await signUp(app);
      const res = await client.inject({ method: 'POST', url: '/auth/logout' });
      expect(res.statusCode).toBe(204);
      expect(res.cookies.find((c) => c.name === 'sid')?.value).toBe('');
      // El token antiguo ya no vale, aunque alguien lo hubiera copiado.
      expect(
        (await withCookie(app, cookie).inject({ method: 'GET', url: '/auth/me' })).statusCode,
      ).toBe(401);
    });

    it('una sesión caducada da 401', async () => {
      const { client } = await signUp(app);
      await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
      expect(
        (
          await client.inject({
            method: 'GET',
            url: '/events?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
          })
        ).statusCode,
      ).toBe(401);
    });
  });

  describe('sesiones activas', () => {
    it('lista las sesiones del usuario, marcando la actual, sin las de otro', async () => {
      const ana = await signUp(app, 'ana@example.com');
      const other = await signUp(app, 'other@example.com');
      // Una segunda sesión de Ana, iniciando en otro «dispositivo».
      const second = await login({ email: 'ana@example.com', password: TEST_PASSWORD });
      const secondCookie = `sid=${second.cookies.find((c) => c.name === 'sid')!.value}`;

      const listed = await ana.client.inject({ method: 'GET', url: '/auth/sessions' });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toHaveLength(2);
      expect(listed.json().filter((s: { current: boolean }) => s.current)).toHaveLength(1);

      const fromSecond = await withCookie(app, secondCookie).inject({
        method: 'GET',
        url: '/auth/sessions',
      });
      expect(fromSecond.json().find((s: { current: boolean }) => s.current)).toBeDefined();

      // El otro usuario solo ve la suya (la de su propio registro), no las de Ana.
      const othersSessions = (
        await other.client.inject({ method: 'GET', url: '/auth/sessions' })
      ).json();
      expect(othersSessions).toHaveLength(1);
      expect(othersSessions[0].current).toBe(true);
    });

    it('cierra una sesión propia por id (no la actual); la de otro usuario da 404', async () => {
      const ana = await signUp(app, 'ana@example.com');
      const other = await signUp(app, 'other@example.com');
      const second = await login({ email: 'ana@example.com', password: TEST_PASSWORD });
      const secondCookie = `sid=${second.cookies.find((c) => c.name === 'sid')!.value}`;
      // `ana.client` siempre usa la primera sesión: la segunda aparece como `current: false`.
      const sessions: { id: string; current: boolean }[] = (
        await ana.client.inject({ method: 'GET', url: '/auth/sessions' })
      ).json();
      const otherSession = sessions.find((s) => !s.current)!;

      expect(
        (
          await other.client.inject({
            method: 'DELETE',
            url: `/auth/sessions/${otherSession.id}`,
          })
        ).statusCode,
      ).toBe(404);

      const closed = await ana.client.inject({
        method: 'DELETE',
        url: `/auth/sessions/${otherSession.id}`,
      });
      expect(closed.statusCode).toBe(204);
      // La sesión con la que se hizo la petición (la primera) sigue siendo válida.
      expect((await ana.client.inject({ method: 'GET', url: '/auth/me' })).statusCode).toBe(200);
      // La sesión cerrada (la segunda) ya no vale.
      expect(
        (await withCookie(app, secondCookie).inject({ method: 'GET', url: '/auth/me' })).statusCode,
      ).toBe(401);
    });

    it('cerrar la sesión con la que se hace la petición también borra la cookie', async () => {
      const { client } = await signUp(app);
      const [{ id }] = (await client.inject({ method: 'GET', url: '/auth/sessions' })).json();
      const res = await client.inject({ method: 'DELETE', url: `/auth/sessions/${id}` });
      expect(res.statusCode).toBe(204);
      expect(res.cookies.find((c) => c.name === 'sid')?.value).toBe('');
      expect((await client.inject({ method: 'GET', url: '/auth/me' })).statusCode).toBe(401);
    });

    it('un id con formato inválido da 400; uno inexistente, 404', async () => {
      const { client } = await signUp(app);
      expect(
        (await client.inject({ method: 'DELETE', url: '/auth/sessions/no-es-un-uuid' })).statusCode,
      ).toBe(400);
      expect(
        (
          await client.inject({
            method: 'DELETE',
            url: '/auth/sessions/00000000-0000-0000-0000-000000000000',
          })
        ).statusCode,
      ).toBe(404);
    });
  });

  describe('protección de rutas', () => {
    it.each([
      ['GET', '/calendars'],
      ['POST', '/calendars'],
      ['GET', '/events?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z'],
      ['POST', '/events'],
      ['GET', '/auth/me'],
      ['POST', '/auth/logout'],
      ['GET', '/auth/sessions'],
      ['DELETE', '/auth/sessions/00000000-0000-0000-0000-000000000000'],
    ])('%s %s sin sesión da 401', async (method, url) => {
      const res = await app.inject({ method: method as 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('unauthorized');
    });

    it('una cookie con un token inventado da 401', async () => {
      const res = await withCookie(app, 'sid=inventado').inject({
        method: 'GET',
        url: '/calendars',
      });
      expect(res.statusCode).toBe(401);
    });

    it('/health sigue siendo público', async () => {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    });
  });

  describe('aislamiento entre cuentas', () => {
    it('cada usuario solo ve y toca lo suyo', async () => {
      const ana = await signUp(app, 'ana@example.com');
      const luis = await signUp(app, 'luis@example.com');
      const created = await ana.client.inject({
        method: 'POST',
        url: '/events',
        payload: {
          calendarId: ana.calendarId,
          title: 'Privado',
          startAt: '2026-09-21T08:00:00Z',
          endAt: '2026-09-21T09:00:00Z',
          timezone: 'UTC',
        },
      });
      const { id } = created.json();

      const range = '/events?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z';
      expect((await luis.client.inject({ method: 'GET', url: range })).json()).toEqual([]);
      expect((await luis.client.inject({ method: 'GET', url: `/events/${id}` })).statusCode).toBe(
        404,
      );
      expect(
        (await luis.client.inject({ method: 'GET', url: `/events/${id}/versions` })).statusCode,
      ).toBe(404);
      expect(
        (await luis.client.inject({ method: 'DELETE', url: `/events/${id}` })).statusCode,
      ).toBe(404);
      expect((await luis.client.inject({ method: 'GET', url: '/calendars' })).json()).toHaveLength(
        1,
      );
      // Luis no puede crear eventos en el calendario de Ana.
      const intrusion = await luis.client.inject({
        method: 'POST',
        url: '/events',
        payload: {
          calendarId: ana.calendarId,
          title: 'X',
          startAt: '2026-09-21T08:00:00Z',
          endAt: '2026-09-21T09:00:00Z',
          timezone: 'UTC',
        },
      });
      expect(intrusion.statusCode).toBe(404);
    });
  });

  describe('límite de intentos', () => {
    it('bloquea con 429 tras 10 intentos por minuto', async () => {
      const limited = await buildTestApp(pool, { rateLimit: true });
      const attempt = () =>
        limited.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'x@example.com', password: 'wrong-password' },
        });
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await attempt()).statusCode);
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });

    it('con trustProxy, cuenta la IP de X-Forwarded-For; sin él, se ignora', async () => {
      const attempt = (app: FastifyInstance, ip: string) =>
        app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'x@example.com', password: 'wrong-password' },
          headers: { 'x-forwarded-for': ip },
        });

      const trusted = await buildTestApp(pool, { rateLimit: true, trustProxy: true });
      const statuses: number[] = [];
      for (let i = 0; i < 10; i++) statuses.push((await attempt(trusted, '1.1.1.1')).statusCode);
      expect(statuses.every((s) => s === 401)).toBe(true);
      // Otra IP (según la cabecera) tiene su propio cupo; la primera ya agotó el suyo.
      expect((await attempt(trusted, '2.2.2.2')).statusCode).toBe(401);
      expect((await attempt(trusted, '1.1.1.1')).statusCode).toBe(429);

      // Sin trustProxy (por defecto), la cabecera no cuenta: todo comparte la IP real de
      // la conexión, así que una tercera IP «distinta» ya está limitada.
      const untrusted = await buildTestApp(pool, { rateLimit: true });
      for (let i = 0; i < 10; i++) await attempt(untrusted, '3.3.3.3');
      expect((await attempt(untrusted, '4.4.4.4')).statusCode).toBe(429);
    });
  });
});
