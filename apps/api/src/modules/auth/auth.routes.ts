import type { FastifyInstance, FastifyReply } from 'fastify';
import { loginSchema, registerSchema, type UserDto } from '@calendar/shared';
import { withTransaction, type Db } from '../../db.ts';
import { AppError, ConflictError } from '../../errors.ts';
import { hashPassword, verifyAgainstDummy, verifyPassword, type ScryptParams } from './password.ts';
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findSessionUser,
} from './sessions.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuario autenticado de la petición (solo en rutas protegidas). */
    userId: string;
  }
}

export interface AuthOptions {
  /** Cookie `Secure`: solo se envía por HTTPS. Debe ser true en producción. */
  secureCookies: boolean;
  registrationOpen: boolean;
  /** Límite de intentos por IP en /auth/login y /auth/register. */
  rateLimit: boolean;
  scrypt: ScryptParams;
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // Lax: no se envía en peticiones POST/PUT/DELETE entre sitios, lo que frena el CSRF.
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Rutas públicas: crear cuenta e iniciar sesión. */
export function registerAuthRoutes(app: FastifyInstance, db: Db, opts: AuthOptions): void {
  const limited = opts.rateLimit
    ? { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }
    : {};

  app.post('/auth/register', limited, async (request, reply) => {
    if (!opts.registrationOpen) {
      throw new AppError(403, 'registration_closed', 'El registro de nuevas cuentas está cerrado');
    }
    const input = registerSchema.parse(request.body);
    const passwordHash = await hashPassword(input.password, opts.scrypt);

    const { user, token } = await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<UserDto>(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name`,
        [input.email, input.name, passwordHash],
      );
      const created = rows[0];
      if (!created) throw new ConflictError('email_taken', 'Ya existe una cuenta con ese email');
      await tx.query("INSERT INTO calendars (user_id, name) VALUES ($1, 'Personal')", [created.id]);
      return { user: created, token: await createSession(tx, created.id) };
    });

    setSessionCookie(reply, token, opts.secureCookies);
    return reply.code(201).send(user);
  });

  app.post('/auth/login', limited, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const { rows } = await db.query<UserDto & { password_hash: string | null }>(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [input.email],
    );
    const row = rows[0];

    const valid = row?.password_hash
      ? await verifyPassword(input.password, row.password_hash)
      : (await verifyAgainstDummy(input.password, opts.scrypt), false);
    if (!row || !valid) {
      throw new AppError(401, 'invalid_credentials', 'Email o contraseña incorrectos');
    }

    await deleteExpiredSessions(db);
    setSessionCookie(reply, await createSession(db, row.id), opts.secureCookies);
    return { id: row.id, email: row.email, name: row.name } satisfies UserDto;
  });
}

/** Exige sesión válida en todo lo registrado dentro de este scope y fija `request.userId`. */
export function requireSession(app: FastifyInstance, db: Db): void {
  app.decorateRequest('userId', '');
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    const userId = token ? await findSessionUser(db, token) : null;
    if (!userId) throw new AppError(401, 'unauthorized', 'Inicia sesión para continuar');
    request.userId = userId;
  });
}

/** Rutas que necesitan sesión: quién soy y cerrar sesión. */
export function registerSessionRoutes(app: FastifyInstance, db: Db, opts: AuthOptions): void {
  app.get('/auth/me', async (request) => {
    const { rows } = await db.query<UserDto>('SELECT id, email, name FROM users WHERE id = $1', [
      request.userId,
    ]);
    return rows[0]!;
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/', secure: opts.secureCookies, sameSite: 'lax' });
    return reply.code(204).send();
  });
}
