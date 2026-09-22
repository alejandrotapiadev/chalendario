import type { EventFields, EventSnapshot, EventStatus, RecurrenceRule } from '@calendar/domain';
import type { EventDto } from '@calendar/shared';
import type { Queryable } from '../../db.ts';
import { readableBy } from '../calendars/access.ts';

/** Columnas de contenido que tienen en común las versiones y el estado actual. */
interface ContentRow {
  title: string;
  description: string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  all_day: boolean;
  location: string;
  status: EventStatus;
  color: string | null;
  recurrence: RecurrenceRule | null;
  category_id: string | null;
  deleted: boolean;
}

export interface EventRow extends ContentRow {
  id: string;
  /** UID externo (importación / sincronización), o null en los eventos creados aquí. */
  uid: string | null;
  calendar_id: string;
  series_id: string | null;
  /** Instante de la ocurrencia original que este evento sustituye, si es una excepción. */
  recurrence_id: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  /** Minutos de antelación de los recordatorios, ordenados. */
  reminders: number[];
}

export interface VersionRow extends ContentRow {
  version: number;
  created_at: Date;
  change_reason: string | null;
  /** Nombre de quien hizo el cambio. */
  author_name: string | null;
}

// Estado actual = fila de `events` + su versión vigente. El join con `calendars` acota
// todas las consultas a los eventos del usuario.
const CURRENT_EVENTS = `
  SELECT e.id, e.uid, e.calendar_id, e.series_id, e.recurrence_id, e.current_version AS version,
         e.created_at, e.updated_at,
         v.title, v.description, v.start_at, v.end_at, v.timezone, v.all_day,
         v.location, v.status, v.color, v.recurrence, v.category_id, v.deleted,
         ARRAY(SELECT r.minutes_before FROM event_reminders r
                WHERE r.event_id = e.id ORDER BY r.minutes_before) AS reminders
    FROM events e
    JOIN event_versions v ON v.event_id = e.id AND v.version = e.current_version
    JOIN calendars c ON c.id = e.calendar_id`;

export function rowToFields(row: ContentRow): EventFields {
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
    recurrence: row.recurrence,
    categoryId: row.category_id,
  };
}

export function rowToSnapshot(row: ContentRow): EventSnapshot {
  return { ...rowToFields(row), deleted: row.deleted };
}

export function rowToDto(row: EventRow): EventDto {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    seriesId: row.series_id,
    recurrenceId: row.recurrence_id?.toISOString() ?? null,
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
    recurrence: row.recurrence,
    categoryId: row.category_id,
    reminders: row.reminders,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Evento del usuario con su versión vigente (incluye los borrados). Con `lock`, bloquea antes
 * la fila de `events` y **después** lee el estado en otra sentencia.
 *
 * No se junta todo en un `SELECT … FOR UPDATE` con joins: si otra transacción modifica el
 * evento mientras esperamos el bloqueo, PostgreSQL vuelve a evaluar la fila bloqueada pero
 * los demás joins siguen con el snapshot antiguo, con lo que la versión nueva (`event_versions`)
 * no se encuentra y el evento parecería no existir. Una sentencia nueva ve lo ya confirmado.
 */
export async function findCurrent(
  db: Queryable,
  userId: string,
  id: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<EventRow | null> {
  if (lock) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM events e JOIN calendars c ON c.id = e.calendar_id
        WHERE e.id = $1 AND ${readableBy('$2')} FOR UPDATE OF e`,
      [id, userId],
    );
    if (rowCount === 0) return null;
  }
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS} WHERE e.id = $1 AND ${readableBy('$2')}`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export interface RangeQuery {
  from: Date;
  to: Date;
  calendarId?: string | undefined;
  categoryId?: string | undefined;
}

/** Filtros opcionales de calendario y categoría; añade sus valores a `values`. */
function extraFilters(range: RangeQuery, values: unknown[]): string {
  const parts: string[] = [];
  if (range.calendarId) {
    values.push(range.calendarId);
    parts.push(`AND e.calendar_id = $${values.length}`);
  }
  if (range.categoryId) {
    values.push(range.categoryId);
    parts.push(`AND v.category_id = $${values.length}`);
  }
  return parts.join(' ');
}

/**
 * Eventos vigentes y no borrados que **no** se repiten y se solapan con [from, to). Excluye
 * las excepciones de una serie (`series_id` no nulo): esas solo aparecen como solapamiento
 * de su serie (ver `occurrencesOf`), para no salir duplicadas.
 */
export async function listSingleInRange(
  db: Queryable,
  userId: string,
  range: RangeQuery,
): Promise<EventRow[]> {
  const values: unknown[] = [userId, range.from, range.to];
  const filters = extraFilters(range, values);
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS}
      WHERE ${readableBy('$1')} AND NOT c.archived AND NOT v.deleted AND v.recurrence IS NULL
        AND e.series_id IS NULL AND v.start_at < $3 AND v.end_at > $2 ${filters}
      ORDER BY v.start_at, v.end_at, e.id`,
    values,
  );
  return rows;
}

/**
 * Series recurrentes vigentes que pueden tener ocurrencias antes de `range.to`. No se puede
 * filtrar más en SQL (el fin depende de la regla): la expansión descarta lo que sobre.
 */
export async function listRecurringBefore(
  db: Queryable,
  userId: string,
  range: RangeQuery,
): Promise<EventRow[]> {
  const values: unknown[] = [userId, range.to];
  const filters = extraFilters(range, values);
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS}
      WHERE ${readableBy('$1')} AND NOT c.archived AND NOT v.deleted AND v.recurrence IS NOT NULL
        AND v.start_at < $2 ${filters}
      ORDER BY v.start_at, e.id`,
    values,
  );
  return rows;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Busca en título, descripción y ubicación, sin distinguir mayúsculas ni acentos. Devuelve
 * el evento tal como está definido (la primera ocurrencia si se repite), lo más reciente
 * primero.
 */
export async function searchCurrent(
  db: Queryable,
  userId: string,
  q: string,
  limit: number,
): Promise<EventRow[]> {
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS}
      WHERE ${readableBy('$1')} AND NOT c.archived AND NOT v.deleted
        AND (unaccent(v.title) ILIKE unaccent($2)
          OR unaccent(v.description) ILIKE unaccent($2)
          OR unaccent(v.location) ILIKE unaccent($2))
      ORDER BY v.start_at DESC, e.id
      LIMIT $3`,
    [userId, `%${escapeLike(q)}%`, limit],
  );
  return rows;
}

/**
 * Eventos borrados (su versión vigente tiene `deleted = true`), los más recientes primero.
 * `e.updated_at` es de cuando se aplicó esa versión, es decir, de cuando se borraron.
 */
export async function listDeletedEvents(
  db: Queryable,
  userId: string,
  limit = 200,
): Promise<EventRow[]> {
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS}
      WHERE ${readableBy('$1')} AND v.deleted
      ORDER BY e.updated_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/**
 * Eventos vivos con recordatorios que podrían tener uno activo en `at`: los que no se
 * repiten y aún no han terminado, y las series que ya han empezado o empiezan antes de `horizon`.
 */
export async function listReminderCandidates(
  db: Queryable,
  userId: string,
  at: Date,
  horizon: Date,
): Promise<EventRow[]> {
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS}
      WHERE ${readableBy('$1')} AND NOT c.archived AND NOT v.deleted AND v.status <> 'cancelled'
        AND EXISTS (SELECT 1 FROM event_reminders r WHERE r.event_id = e.id)
        AND v.start_at <= $3
        AND (v.recurrence IS NOT NULL OR v.end_at > $2)`,
    [userId, at, horizon],
  );
  return rows;
}

export async function insertEvent(
  db: Queryable,
  calendarId: string,
  uid: string | null = null,
  seriesId: string | null = null,
  recurrenceId: Date | null = null,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO events (calendar_id, uid, series_id, recurrence_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [calendarId, uid, seriesId, recurrenceId],
  );
  return rows[0]!.id;
}

/** Excepción de esa serie para esa ocurrencia exacta, si existe (borrada o no). */
export async function findExceptionRow(
  db: Queryable,
  userId: string,
  seriesId: string,
  recurrenceId: Date,
): Promise<EventRow | null> {
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS}
      WHERE ${readableBy('$1')} AND e.series_id = $2 AND e.recurrence_id = $3`,
    [userId, seriesId, recurrenceId],
  );
  return rows[0] ?? null;
}

/**
 * Todas las excepciones (borradas o no) de esas series. Las borradas hacen falta para saber
 * qué fechas ya no se deben expandir de la serie original, aunque no se muestren.
 */
export async function listExceptionsForSeries(
  db: Queryable,
  userId: string,
  seriesIds: string[],
): Promise<EventRow[]> {
  if (seriesIds.length === 0) return [];
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS} WHERE ${readableBy('$1')} AND e.series_id = ANY($2)`,
    [userId, seriesIds],
  );
  return rows;
}

/** Reasigna a la serie nueva las excepciones de `oldSeriesId` a partir de `fromInstant`. */
export async function reassignExceptions(
  db: Queryable,
  oldSeriesId: string,
  newSeriesId: string,
  fromInstant: Date,
): Promise<void> {
  await db.query('UPDATE events SET series_id = $2 WHERE series_id = $1 AND recurrence_id >= $3', [
    oldSeriesId,
    newSeriesId,
    fromInstant,
  ]);
}

/** Evento de ese calendario con ese UID externo (borrado o no). */
export async function findEventIdByUid(
  db: Queryable,
  calendarId: string,
  uid: string,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM events WHERE calendar_id = $1 AND uid = $2',
    [calendarId, uid],
  );
  return rows[0]?.id ?? null;
}

export async function eventExistsInCalendar(
  db: Queryable,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM events WHERE calendar_id = $1 AND id = $2', [
    calendarId,
    eventId,
  ]);
  return rowCount === 1;
}

/** Todos los eventos vivos de un calendario (series sin expandir). El llamador ya comprobó el acceso. */
export async function listCalendarEventRows(
  db: Queryable,
  calendarId: string,
): Promise<EventRow[]> {
  const { rows } = await db.query<EventRow>(
    `${CURRENT_EVENTS} WHERE e.calendar_id = $1 AND NOT v.deleted ORDER BY v.start_at, e.id`,
    [calendarId],
  );
  return rows;
}

/** Eventos vivos con UID externo de un calendario, para saber cuáles ya no están en el origen. */
export async function listLiveUidRows(
  db: Queryable,
  calendarId: string,
): Promise<{ id: string; uid: string }[]> {
  const { rows } = await db.query<{ id: string; uid: string }>(
    `SELECT e.id, e.uid
       FROM events e
       JOIN event_versions v ON v.event_id = e.id AND v.version = e.current_version
      WHERE e.calendar_id = $1 AND e.uid IS NOT NULL AND NOT v.deleted`,
    [calendarId],
  );
  return rows;
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
        location, status, color, recurrence, category_id, deleted, created_by, change_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16)`,
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
      f.recurrence === null ? null : JSON.stringify(f.recurrence),
      f.categoryId,
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

/** Deja exactamente estos recordatorios (minutos de antelación) en el evento. */
export async function replaceReminders(
  db: Queryable,
  eventId: string,
  minutes: number[],
): Promise<void> {
  await db.query(
    'DELETE FROM event_reminders WHERE event_id = $1 AND NOT (minutes_before = ANY($2::int[]))',
    [eventId, minutes],
  );
  await db.query(
    `INSERT INTO event_reminders (event_id, minutes_before)
     SELECT $1, m FROM unnest($2::int[]) AS m
     ON CONFLICT (event_id, minutes_before, channel) DO NOTHING`,
    [eventId, minutes],
  );
}

const VERSION_COLUMNS = `
  v.version, v.title, v.description, v.start_at, v.end_at, v.timezone, v.all_day,
  v.location, v.status, v.color, v.recurrence, v.category_id, v.deleted, v.created_at,
  v.change_reason, au.name AS author_name`;

/**
 * Historial completo de un evento del usuario, de la versión más antigua a la más reciente.
 * Incluye los eventos borrados. Vacío si el evento no existe o no es del usuario.
 */
export async function listVersionRows(
  db: Queryable,
  userId: string,
  eventId: string,
): Promise<VersionRow[]> {
  const { rows } = await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS}
       FROM event_versions v
       JOIN events e ON e.id = v.event_id
       JOIN calendars c ON c.id = e.calendar_id
       LEFT JOIN users au ON au.id = v.created_by
      WHERE v.event_id = $1 AND ${readableBy('$2')}
      ORDER BY v.version`,
    [eventId, userId],
  );
  return rows;
}

export async function findVersionRow(
  db: Queryable,
  userId: string,
  eventId: string,
  version: number,
): Promise<VersionRow | null> {
  const { rows } = await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS}
       FROM event_versions v
       JOIN events e ON e.id = v.event_id
       JOIN calendars c ON c.id = e.calendar_id
       LEFT JOIN users au ON au.id = v.created_by
      WHERE v.event_id = $1 AND ${readableBy('$2')} AND v.version = $3`,
    [eventId, userId, version],
  );
  return rows[0] ?? null;
}
