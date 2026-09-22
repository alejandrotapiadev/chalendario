import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../../db.ts';

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Crea una sesión y devuelve el token en claro, que solo existe en la cookie del cliente. */
export async function createSession(db: Queryable, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, hashToken(token), SESSION_DAYS],
  );
  return token;
}

export interface SessionIdentity {
  sessionId: string;
  userId: string;
}

export async function findSessionUser(
  db: Queryable,
  token: string,
): Promise<SessionIdentity | null> {
  const { rows } = await db.query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [hashToken(token)],
  );
  return rows[0] ? { sessionId: rows[0].id, userId: rows[0].user_id } : null;
}

export async function deleteSession(db: Queryable, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function deleteExpiredSessions(db: Queryable): Promise<void> {
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}

export interface SessionRow {
  id: string;
  created_at: Date;
  expires_at: Date;
}

/** Sesiones activas del usuario, la más reciente primero. */
export async function listSessions(db: Queryable, userId: string): Promise<SessionRow[]> {
  const { rows } = await db.query<SessionRow>(
    `SELECT id, created_at, expires_at FROM sessions
      WHERE user_id = $1 AND expires_at > now()
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

/** Cierra una sesión propia por id; no toca las de otro usuario. */
export async function deleteSessionById(
  db: Queryable,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [
    sessionId,
    userId,
  ]);
  return rowCount === 1;
}
