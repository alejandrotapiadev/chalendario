import type { CalendarDto } from '@calendar/shared';
import type { Queryable } from '../../db.ts';
import { readableBy, type CalendarRole } from './access.ts';

interface CalendarRow {
  id: string;
  name: string;
  color: string;
  created_at: Date;
  updated_at: Date;
  role: CalendarRole;
  owner_name: string;
  owner_id: string;
  sub_url: string | null;
  last_synced_at: Date | null;
  last_error: string | null;
}

// `$1` es siempre el usuario que consulta. Incluye los calendarios propios y los compartidos
// con él (invitación aceptada).
const SELECT = `
  SELECT c.id, c.name, c.color, c.created_at, c.updated_at, c.user_id AS owner_id,
         CASE WHEN c.user_id = $1 THEN 'owner' ELSE m.role END AS role,
         o.name AS owner_name,
         s.url AS sub_url, s.last_synced_at, s.last_error
    FROM calendars c
    JOIN users o ON o.id = c.user_id
    LEFT JOIN calendar_members m
           ON m.calendar_id = c.id AND m.user_id = $1 AND m.status = 'accepted'
    LEFT JOIN calendar_subscriptions s ON s.calendar_id = c.id`;

function toDto(row: CalendarRow): CalendarDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    role: row.role,
    ownerName: row.role === 'owner' ? null : row.owner_name,
    // De la URL solo se expone el dominio: puede llevar un secreto en la ruta.
    subscription: row.sub_url
      ? {
          host: new URL(row.sub_url).hostname,
          lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
          lastError: row.last_error,
        }
      : null,
  };
}

export async function listCalendars(db: Queryable, userId: string): Promise<CalendarDto[]> {
  const { rows } = await db.query<CalendarRow>(
    `${SELECT} WHERE ${readableBy('$1')} ORDER BY (c.user_id <> $1), c.created_at, c.name`,
    [userId],
  );
  return rows.map(toDto);
}

export async function getCalendar(
  db: Queryable,
  userId: string,
  id: string,
): Promise<CalendarDto | null> {
  const { rows } = await db.query<CalendarRow>(
    `${SELECT} WHERE c.id = $2 AND ${readableBy('$1')}`,
    [userId, id],
  );
  return rows[0] ? toDto(rows[0]) : null;
}

export async function insertCalendar(
  db: Queryable,
  userId: string,
  input: { name: string; color?: string | undefined },
): Promise<CalendarDto> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO calendars (user_id, name, color) VALUES ($1, $2, COALESCE($3, '#3b82f6'))
     RETURNING id`,
    [userId, input.name, input.color ?? null],
  );
  return (await getCalendar(db, userId, rows[0]!.id))!;
}

export async function updateCalendar(
  db: Queryable,
  userId: string,
  id: string,
  input: { name?: string | undefined; color?: string | undefined },
): Promise<CalendarDto | null> {
  const { rowCount } = await db.query(
    `UPDATE calendars
        SET name = COALESCE($3, name), color = COALESCE($4, color), updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [id, userId, input.name ?? null, input.color ?? null],
  );
  return rowCount === 1 ? getCalendar(db, userId, id) : null;
}

export async function calendarBelongsToUser(
  db: Queryable,
  userId: string,
  calendarId: string,
): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM calendars WHERE id = $1 AND user_id = $2', [
    calendarId,
    userId,
  ]);
  return rowCount === 1;
}

/** ¿El calendario refleja una URL externa? Entonces sus eventos son de solo lectura. */
export async function isSubscribed(db: Queryable, calendarId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM calendar_subscriptions WHERE calendar_id = $1',
    [calendarId],
  );
  return rowCount === 1;
}
