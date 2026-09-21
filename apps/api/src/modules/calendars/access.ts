import type { Queryable } from '../../db.ts';
import { AppError, NotFoundError } from '../../errors.ts';

/** Papel de un usuario sobre un calendario. */
export type CalendarRole = 'owner' | 'editor' | 'viewer';

/**
 * Condición SQL «el usuario puede ver este calendario»: es el propietario o un miembro con la
 * invitación aceptada. Espera el alias `c` para `calendars`; `param` es el marcador
 * (`$1`…) del id de usuario. Las invitaciones pendientes NO dan acceso.
 */
export function readableBy(param: string): string {
  return `(c.user_id = ${param} OR EXISTS (
    SELECT 1 FROM calendar_members m
     WHERE m.calendar_id = c.id AND m.user_id = ${param} AND m.status = 'accepted'))`;
}

/** Papel del usuario en el calendario, o null si no tiene acceso (o el calendario no existe). */
export async function calendarRole(
  db: Queryable,
  userId: string,
  calendarId: string,
): Promise<CalendarRole | null> {
  const { rows } = await db.query<{ role: CalendarRole }>(
    `SELECT CASE WHEN c.user_id = $2 THEN 'owner' ELSE m.role END AS role
       FROM calendars c
       LEFT JOIN calendar_members m
              ON m.calendar_id = c.id AND m.user_id = $2 AND m.status = 'accepted'
      WHERE c.id = $1 AND (c.user_id = $2 OR m.user_id IS NOT NULL)`,
    [calendarId, userId],
  );
  return rows[0]?.role ?? null;
}

const readOnly = () =>
  new AppError(403, 'forbidden', 'Solo tienes permiso de lectura en este calendario');

/**
 * Exige poder escribir eventos en el calendario. Sin acceso da 404 (no se revela que existe);
 * con acceso de solo lectura, 403.
 */
export async function assertCanEdit(
  db: Queryable,
  userId: string,
  calendarId: string,
): Promise<CalendarRole> {
  const role = await calendarRole(db, userId, calendarId);
  if (role === null) throw new NotFoundError('Calendario');
  if (role === 'viewer') throw readOnly();
  return role;
}
