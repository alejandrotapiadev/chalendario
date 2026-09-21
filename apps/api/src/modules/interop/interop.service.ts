import { createHash, randomBytes } from 'node:crypto';
import { IcsError, isValidTimezone, parseIcs, serializeIcs } from '@calendar/domain';
import type {
  CalendarDto,
  FeedCreatedDto,
  FeedStatusDto,
  ImportIcsInput,
  ImportResultDto,
  SubscribeInput,
  SubscribeResultDto,
} from '@calendar/shared';
import { withTransaction, type Db, type Queryable } from '../../db.ts';
import { AppError, ConflictError, NotFoundError } from '../../errors.ts';
import { UnsafeUrlError, fetchText, parseSubscriptionUrl } from '../../net/safe-fetch.ts';
import {
  calendarBelongsToUser,
  getCalendar,
  insertCalendar,
  isSubscribed,
} from '../calendars/calendars.repository.ts';
import { listCalendarEventRows, rowToFields } from '../events/events.repository.ts';
import { OWN_UID_SUFFIX, applyParsedIcs } from './apply-ics.ts';

/** Descarga el `.ics` de una URL. Es inyectable para probar sin red. */
export type FetchIcs = (url: string) => Promise<string>;
export const defaultFetchIcs: FetchIcs = (url) => fetchText(url);

/** Máximo de eventos que se aplican de una vez (importación o sincronización). */
const MAX_EVENTS = 5000;

// ---------------------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------------------

async function categoryMap(db: Queryable, userId: string) {
  const { rows } = await db.query<{ id: string; name: string }>(
    'SELECT id, name::text AS name FROM categories WHERE user_id = $1',
    [userId],
  );
  return rows;
}

/** Contenido `.ics` de un calendario. El llamador ya comprobó que se puede leer. */
async function serializeCalendar(db: Queryable, userId: string, calendarId: string, name: string) {
  const [rows, categories] = await Promise.all([
    listCalendarEventRows(db, calendarId),
    categoryMap(db, userId),
  ]);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  // DTSTAMP = última modificación (no la hora actual): así el contenido no cambia entre
  // descargas si no cambian los eventos, y el ETag del feed sirve.
  const now = rows.reduce(
    (latest, r) => (r.updated_at > latest ? r.updated_at : latest),
    new Date(0),
  );
  return serializeIcs({
    name,
    now,
    events: rows.map((row) => ({
      uid: row.uid ?? `${row.id}${OWN_UID_SUFFIX}`,
      sequence: row.version - 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      fields: rowToFields(row),
      reminders: row.reminders,
      categoryName: row.category_id ? (names.get(row.category_id) ?? null) : null,
    })),
  });
}

export async function exportCalendar(
  db: Db,
  userId: string,
  calendarId: string,
): Promise<{ name: string; text: string }> {
  const calendar = await getCalendar(db, userId, calendarId);
  if (!calendar) throw new NotFoundError('Calendario');
  return {
    name: calendar.name,
    text: await serializeCalendar(db, userId, calendarId, calendar.name),
  };
}

// ---------------------------------------------------------------------------------------
// Importar
// ---------------------------------------------------------------------------------------

function parseOrFail(text: string, timezone: string) {
  if (!isValidTimezone(timezone))
    throw new AppError(400, 'invalid_timezone', 'Zona horaria desconocida');
  try {
    const parsed = parseIcs(text, timezone);
    if (parsed.events.length > MAX_EVENTS) {
      throw new AppError(413, 'too_many_events', `El fichero tiene más de ${MAX_EVENTS} eventos`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof IcsError) throw new AppError(400, 'invalid_ics', err.message);
    throw err;
  }
}

async function categoryIds(db: Queryable, userId: string) {
  return new Map((await categoryMap(db, userId)).map((c) => [c.name.toLowerCase(), c.id]));
}

export async function importIcs(
  db: Db,
  userId: string,
  calendarId: string,
  input: ImportIcsInput,
): Promise<ImportResultDto> {
  const parsed = parseOrFail(input.ics, input.timezone);
  return withTransaction(db, async (tx) => {
    if (!(await calendarBelongsToUser(tx, userId, calendarId)))
      throw new NotFoundError('Calendario');
    if (await isSubscribed(tx, calendarId)) {
      throw new ConflictError(
        'calendar_read_only',
        'Este calendario está sincronizado con una URL y es de solo lectura',
      );
    }
    return applyParsedIcs(tx, {
      userId,
      calendarId,
      parsed,
      categories: await categoryIds(tx, userId),
      reason: 'import',
      mirror: false,
    });
  });
}

// ---------------------------------------------------------------------------------------
// Enlace de suscripción (feed .ics público de solo lectura)
// ---------------------------------------------------------------------------------------

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** 32 bytes en base64url. */
export const FEED_FILE = /^([A-Za-z0-9_-]{43})\.ics$/;

export async function feedStatus(
  db: Db,
  userId: string,
  calendarId: string,
): Promise<FeedStatusDto> {
  if (!(await calendarBelongsToUser(db, userId, calendarId))) throw new NotFoundError('Calendario');
  const { rows } = await db.query<{ created_at: Date }>(
    'SELECT created_at FROM calendar_feeds WHERE calendar_id = $1',
    [calendarId],
  );
  return { enabled: rows.length === 1, createdAt: rows[0]?.created_at.toISOString() ?? null };
}

/** Crea el enlace o, si ya había uno, lo regenera (el anterior deja de funcionar). */
export async function createFeed(
  db: Db,
  userId: string,
  calendarId: string,
): Promise<FeedCreatedDto> {
  if (!(await calendarBelongsToUser(db, userId, calendarId))) throw new NotFoundError('Calendario');
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO calendar_feeds (calendar_id, token_hash) VALUES ($1, $2)
     ON CONFLICT (calendar_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()`,
    [calendarId, hashToken(token)],
  );
  return { path: `/feeds/${token}.ics` };
}

export async function deleteFeed(db: Db, userId: string, calendarId: string): Promise<void> {
  if (!(await calendarBelongsToUser(db, userId, calendarId))) throw new NotFoundError('Calendario');
  await db.query('DELETE FROM calendar_feeds WHERE calendar_id = $1', [calendarId]);
}

/** Contenido del feed público, o null si el token no existe (o fue revocado). */
export async function readFeed(db: Db, token: string): Promise<string | null> {
  const { rows } = await db.query<{ calendar_id: string; user_id: string; name: string }>(
    `SELECT f.calendar_id, c.user_id, c.name
       FROM calendar_feeds f JOIN calendars c ON c.id = f.calendar_id
      WHERE f.token_hash = $1`,
    [hashToken(token)],
  );
  const feed = rows[0];
  return feed ? serializeCalendar(db, feed.user_id, feed.calendar_id, feed.name) : null;
}

// ---------------------------------------------------------------------------------------
// Suscripción a una URL .ics externa
// ---------------------------------------------------------------------------------------

/** Mensaje para el usuario a partir de un fallo de descarga (sin filtrar detalles de red). */
function fetchFailure(err: unknown): AppError {
  if (err instanceof UnsafeUrlError) return new AppError(400, 'unsafe_url', err.message);
  const message = err instanceof Error ? err.message : '';
  const known = /^(El servidor|El fichero|Demasiadas)/.test(message);
  return new AppError(
    502,
    'fetch_failed',
    known ? message : 'No se pudo descargar el calendario (¿está accesible la URL?)',
  );
}

async function download(fetchIcs: FetchIcs, url: string, timezone: string) {
  let text: string;
  try {
    text = await fetchIcs(url);
  } catch (err) {
    throw fetchFailure(err);
  }
  return parseOrFail(text, timezone);
}

export async function subscribe(
  db: Db,
  userId: string,
  input: SubscribeInput,
  fetchIcs: FetchIcs,
): Promise<SubscribeResultDto> {
  let url: string;
  try {
    url = parseSubscriptionUrl(input.url).toString();
  } catch (err) {
    throw fetchFailure(err);
  }
  // Se descarga antes de crear nada: una URL que no funciona no deja un calendario vacío.
  const parsed = await download(fetchIcs, url, input.timezone);

  return withTransaction(db, async (tx) => {
    const created = await insertCalendar(tx, userId, { name: input.name, color: input.color });
    await tx.query(
      `INSERT INTO calendar_subscriptions (calendar_id, url, timezone, last_synced_at, last_attempt_at)
       VALUES ($1, $2, $3, now(), now())`,
      [created.id, url, input.timezone],
    );
    const result = await applyParsedIcs(tx, {
      userId,
      calendarId: created.id,
      parsed,
      categories: new Map(),
      reason: 'sync',
      mirror: false,
    });
    const calendar = (await getCalendar(tx, userId, created.id)) as CalendarDto;
    return { calendar, result };
  });
}

interface SubscriptionRow {
  calendar_id: string;
  user_id: string;
  url: string;
  timezone: string;
}

async function loadSubscription(db: Queryable, calendarId: string, userId?: string) {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT s.calendar_id, c.user_id, s.url, s.timezone
       FROM calendar_subscriptions s JOIN calendars c ON c.id = s.calendar_id
      WHERE s.calendar_id = $1 AND ($2::uuid IS NULL OR c.user_id = $2)`,
    [calendarId, userId ?? null],
  );
  return rows[0] ?? null;
}

/**
 * Vuelve a descargar el origen y deja el calendario igual que él (crea, actualiza y borra).
 * Un intento fallido se anota en `last_error` sin tocar los eventos. Si ya hay otra
 * sincronización del mismo calendario en marcha, lanza 409.
 */
async function syncSubscription(
  db: Db,
  sub: SubscriptionRow,
  fetchIcs: FetchIcs,
): Promise<ImportResultDto> {
  await db.query(
    'UPDATE calendar_subscriptions SET last_attempt_at = now() WHERE calendar_id = $1',
    [sub.calendar_id],
  );
  try {
    const parsed = await download(fetchIcs, sub.url, sub.timezone);
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        [`sync:${sub.calendar_id}`],
      );
      if (!rows[0]!.locked)
        throw new ConflictError('sync_in_progress', 'Ya hay una sincronización en curso');
      const result = await applyParsedIcs(tx, {
        userId: sub.user_id,
        calendarId: sub.calendar_id,
        parsed,
        categories: new Map(),
        reason: 'sync',
        mirror: true,
      });
      await tx.query(
        'UPDATE calendar_subscriptions SET last_synced_at = now(), last_error = NULL WHERE calendar_id = $1',
        [sub.calendar_id],
      );
      return result;
    });
  } catch (err) {
    if (!(err instanceof ConflictError)) {
      await db.query('UPDATE calendar_subscriptions SET last_error = $2 WHERE calendar_id = $1', [
        sub.calendar_id,
        err instanceof AppError ? err.message : 'Error inesperado al sincronizar',
      ]);
    }
    throw err;
  }
}

export async function syncCalendar(
  db: Db,
  userId: string,
  calendarId: string,
  fetchIcs: FetchIcs,
): Promise<ImportResultDto> {
  const sub = await loadSubscription(db, calendarId, userId);
  if (!sub) throw new NotFoundError('Suscripción');
  return syncSubscription(db, sub, fetchIcs);
}

export async function unsubscribe(db: Db, userId: string, calendarId: string): Promise<void> {
  if (!(await calendarBelongsToUser(db, userId, calendarId))) throw new NotFoundError('Calendario');
  const { rowCount } = await db.query('DELETE FROM calendar_subscriptions WHERE calendar_id = $1', [
    calendarId,
  ]);
  if (rowCount === 0) throw new NotFoundError('Suscripción');
}

/** Sincroniza las suscripciones cuyo último intento es anterior a `minAgeMs`. */
export async function syncDueSubscriptions(
  db: Db,
  fetchIcs: FetchIcs,
  { minAgeMs, onError }: { minAgeMs: number; onError?: (calendarId: string, err: unknown) => void },
): Promise<number> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT s.calendar_id, c.user_id, s.url, s.timezone
       FROM calendar_subscriptions s JOIN calendars c ON c.id = s.calendar_id
      WHERE s.last_attempt_at IS NULL OR s.last_attempt_at < now() - make_interval(secs => $1)
      ORDER BY s.last_attempt_at NULLS FIRST`,
    [minAgeMs / 1000],
  );
  let synced = 0;
  for (const sub of rows) {
    try {
      await syncSubscription(db, sub, fetchIcs);
      synced++;
    } catch (err) {
      onError?.(sub.calendar_id, err);
    }
  }
  return synced;
}

/** Programa la sincronización periódica. Devuelve la función que la detiene. */
export function startSubscriptionSync(
  db: Db,
  fetchIcs: FetchIcs,
  {
    intervalMs = 15 * 60_000,
    minAgeMs = 30 * 60_000,
    onError,
  }: {
    intervalMs?: number;
    minAgeMs?: number;
    onError?: (calendarId: string, err: unknown) => void;
  } = {},
): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    syncDueSubscriptions(db, fetchIcs, { minAgeMs, ...(onError && { onError }) })
      .catch((err: unknown) => onError?.('*', err))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref(); // no impide que el proceso termine
  tick();
  return () => clearInterval(timer);
}
