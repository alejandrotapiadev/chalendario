import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuario autenticado de la petición. */
    userId: string;
  }
}

/**
 * Autenticación provisional: todas las peticiones actúan como un único usuario local,
 * que se crea (con un calendario «Personal») la primera vez. Se sustituirá por
 * autenticación real (sesiones/tokens) sin tocar los módulos, que solo leen `request.userId`.
 */
export function registerDevAuth(app: FastifyInstance, db: Db, email: string): void {
  let userId: Promise<string> | undefined;

  app.decorateRequest('userId', '');
  app.addHook('preHandler', async (request) => {
    userId ??= ensureDevUser(db, email).catch((err: unknown) => {
      userId = undefined; // no cachear el fallo (p. ej. BD caída): reintentar en la siguiente petición
      throw err;
    });
    request.userId = await userId;
  });
}

async function ensureDevUser(db: Db, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, name) VALUES ($1, 'Yo')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email],
  );
  const id = rows[0]!.id;
  await db.query(
    `INSERT INTO calendars (user_id, name)
     SELECT $1, 'Personal' WHERE NOT EXISTS (SELECT 1 FROM calendars WHERE user_id = $1)`,
    [id],
  );
  return id;
}
