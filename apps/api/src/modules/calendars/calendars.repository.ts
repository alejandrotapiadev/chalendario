import type { CalendarDto } from '@calendar/shared';
import type { Queryable } from '../../db.ts';

interface CalendarRow {
  id: string;
  name: string;
  color: string;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, name, color, created_at, updated_at';

function toDto(row: CalendarRow): CalendarDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listCalendars(db: Queryable, userId: string): Promise<CalendarDto[]> {
  const { rows } = await db.query<CalendarRow>(
    `SELECT ${COLUMNS} FROM calendars WHERE user_id = $1 ORDER BY created_at, name`,
    [userId],
  );
  return rows.map(toDto);
}

export async function insertCalendar(
  db: Queryable,
  userId: string,
  input: { name: string; color?: string | undefined },
): Promise<CalendarDto> {
  const { rows } = await db.query<CalendarRow>(
    `INSERT INTO calendars (user_id, name, color) VALUES ($1, $2, COALESCE($3, '#3b82f6'))
     RETURNING ${COLUMNS}`,
    [userId, input.name, input.color ?? null],
  );
  return toDto(rows[0]!);
}

export async function updateCalendar(
  db: Queryable,
  userId: string,
  id: string,
  input: { name?: string | undefined; color?: string | undefined },
): Promise<CalendarDto | null> {
  const { rows } = await db.query<CalendarRow>(
    `UPDATE calendars
        SET name = COALESCE($3, name), color = COALESCE($4, color), updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING ${COLUMNS}`,
    [id, userId, input.name ?? null, input.color ?? null],
  );
  return rows[0] ? toDto(rows[0]) : null;
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
