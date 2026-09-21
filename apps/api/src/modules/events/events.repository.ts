import type { EventFields, EventStatus } from '@calendar/domain';
import type { EventDto } from '@calendar/shared';
import type { Queryable } from '../../db.ts';

export interface EventRow {
  id: string;
  calendar_id: string;
  series_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  title: string;
  description: string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  all_day: boolean;
  location: string;
  status: EventStatus;
  color: string | null;
  deleted: boolean;
}

// Estado actual = fila de `events` + su versión vigente. El join con `calendars` acota
// todas las consultas a los eventos del usuario.
const CURRENT_EVENTS = `
  SELECT e.id, e.calendar_id, e.series_id, e.current_version AS version,
         e.created_at, e.updated_at,
         v.title, v.description, v.start_at, v.end_at, v.timezone, v.all_day,
         v.location, v.status, v.color, v.deleted
    FROM events e
    JOIN event_versions v ON v.event_id = e.id AND v.version = e.current_version
    JOIN calendars c ON c.id = e.calendar_id`;

export function rowToFields(row: EventRow): EventFields {
  return {
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    allDay: row.all_day,
    location: row.location,
    status: row.status,
    color: row.color,
  };
}

export function rowToDto(row: EventRow): EventDto {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    seriesId: row.series_id,
    version: row.version,
    title: row.title,
    description: row.description,
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    timezone: row.timezone,
    allDay: row.all_day,
    location: row.location,
    status: row.status,
    color: row.color,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Evento del usuario con su versión vigente (incluye los borrados). `lock` bloquea la fila. */
export async function findCurrent(
  db: Queryable,
  userId: string,
  id: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<EventRow | null> {
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS} WHERE e.id = $1 AND c.user_id = $2 ${lock ? 'FOR UPDATE OF e' : ''}`,
    [id, userId],
  );
  return rows[0] ?? null;
}

/** Eventos vigentes y no borrados que se solapan con [from, to). */
export async function listCurrentInRange(
  db: Queryable,
  userId: string,
  range: { from: Date; to: Date; calendarId?: string | undefined },
): Promise<EventRow[]> {
  const values: unknown[] = [userId, range.from, range.to];
  let calendarFilter = '';
  if (range.calendarId) {
    values.push(range.calendarId);
    calendarFilter = 'AND e.calendar_id = $4';
  }
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS}
      WHERE c.user_id = $1 AND NOT v.deleted AND v.start_at < $3 AND v.end_at > $2 ${calendarFilter}
      ORDER BY v.start_at, v.end_at, e.id`,
    values,
  );
  return rows;
}

export async function insertEvent(db: Queryable, calendarId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO events (calendar_id) VALUES ($1) RETURNING id',
    [calendarId],
  );
  return rows[0]!.id;
}

export interface NewVersion {
  eventId: string;
  version: number;
  fields: EventFields;
  deleted: boolean;
  createdBy: string;
  changeReason: string | null;
}

export async function insertVersion(db: Queryable, v: NewVersion): Promise<void> {
  const f = v.fields;
  await db.query(
    `INSERT INTO event_versions
       (event_id, version, title, description, start_at, end_at, timezone, all_day,
        location, status, color, deleted, created_by, change_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      v.eventId,
      v.version,
      f.title,
      f.description,
      f.startAt,
      f.endAt,
      f.timezone,
      f.allDay,
      f.location,
      f.status,
      f.color,
      v.deleted,
      v.createdBy,
      v.changeReason,
    ],
  );
}

export async function setCurrentVersion(
  db: Queryable,
  eventId: string,
  version: number,
): Promise<void> {
  await db.query('UPDATE events SET current_version = $2, updated_at = now() WHERE id = $1', [
    eventId,
    version,
  ]);
}
