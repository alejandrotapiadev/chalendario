import {
  applyEventPatch,
  describeChanges,
  expandOccurrences,
  hasChanges,
  newEventFields,
  splitRecurrenceAt,
  InvalidEventError,
  type EventFields,
  type EventPatch,
  type RecurringSeries,
} from '@calendar/domain';
import type {
  CreateEventInput,
  DeleteEventQuery,
  EventDto,
  EventVersionDto,
  ListEventsQuery,
  SearchEventsQuery,
  UpdateEventInput,
} from '@calendar/shared';
import { withTransaction, type Db, type Queryable } from '../../db.ts';
import { ConflictError, NotFoundError } from '../../errors.ts';
import { assertCanEdit } from '../calendars/access.ts';
import { isArchivedCalendar, isSubscribed } from '../calendars/calendars.repository.ts';
import { categoryBelongsToUser } from '../categories/categories.repository.ts';
import {
  findCurrent,
  findExceptionRow,
  findVersionRow,
  insertEvent,
  insertVersion,
  listDeletedEvents,
  listExceptionsForSeries,
  listRecurringBefore,
  listSingleInRange,
  listVersionRows,
  reassignExceptions,
  replaceReminders,
  rowToDto,
  rowToFields,
  rowToSnapshot,
  searchCurrent,
  setCurrentVersion,
  type EventRow,
  type VersionRow,
} from './events.repository.ts';

// Regla del proyecto (ADR-002): cada modificación de un evento crea una versión nueva y
// las versiones nunca se modifican. Todas las escrituras de este servicio pasan por
// `appendVersion`, dentro de una transacción con la fila del evento bloqueada.

export async function appendVersion(
  tx: Queryable,
  row: EventRow,
  next: { fields: EventFields; deleted: boolean; changeReason: string | null },
  userId: string,
): Promise<EventRow> {
  const version = row.version + 1;
  await insertVersion(tx, {
    eventId: row.id,
    version,
    fields: next.fields,
    deleted: next.deleted,
    createdBy: userId,
    changeReason: next.changeReason,
  });
  await setCurrentVersion(tx, row.id, version);
  return (await findCurrent(tx, userId, row.id))!;
}

/**
 * Los calendarios suscritos a una URL los gestiona la sincronización: editarlos a mano se
 * perdería en la siguiente sincronización, así que se rechaza.
 */
async function assertWritable(tx: Queryable, calendarId: string): Promise<void> {
  if (await isSubscribed(tx, calendarId)) {
    throw new ConflictError(
      'calendar_read_only',
      'Este calendario está sincronizado con una URL y es de solo lectura',
    );
  }
}

/** Crea el evento y su versión 1 (y opcionalmente UID, serie/excepción y recordatorios). */
export async function insertNewEvent(
  tx: Queryable,
  userId: string,
  calendarId: string,
  fields: EventFields,
  opts: {
    reminders?: number[] | undefined;
    uid?: string | null;
    changeReason?: string;
    seriesId?: string | null;
    recurrenceId?: Date | null;
    /** `true` cuando la v1 ya nace borrada (excepción que solo registra un borrado). */
    deleted?: boolean;
  } = {},
): Promise<string> {
  const id = await insertEvent(
    tx,
    calendarId,
    opts.uid ?? null,
    opts.seriesId ?? null,
    opts.recurrenceId ?? null,
  );
  await insertVersion(tx, {
    eventId: id,
    version: 1,
    fields,
    deleted: opts.deleted ?? false,
    createdBy: userId,
    changeReason: opts.changeReason ?? null,
  });
  if (opts.reminders?.length) await replaceReminders(tx, id, uniqueSorted(opts.reminders));
  return id;
}

/** Evento existente, no borrado y bloqueado para escritura; 404 en cualquier otro caso. */
async function lockLiveEvent(tx: Queryable, userId: string, id: string): Promise<EventRow> {
  const row = await findCurrent(tx, userId, id, { lock: true });
  if (!row || row.deleted) throw new NotFoundError('Evento');
  return row;
}

async function assertCategoryOwned(tx: Queryable, userId: string, categoryId?: string | null) {
  if (categoryId && !(await categoryBelongsToUser(tx, userId, categoryId))) {
    throw new NotFoundError('Categoría');
  }
}

/** Sin repetidos y de menor a mayor: así se guardan y se devuelven. */
const uniqueSorted = (minutes: number[]) => [...new Set(minutes)].sort((a, b) => a - b);

/** La serie tal como la necesita el dominio (`packages/domain`), a partir de su fila. */
function asRecurringSeries(row: EventRow): RecurringSeries {
  return {
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    allDay: row.all_day,
    recurrence: row.recurrence!,
  };
}

/**
 * Ocurrencias de un evento dentro de la ventana; un evento que no se repite es la única.
 * `exceptions` son las excepciones (borradas o no) de esta serie: sus fechas originales se
 * excluyen de la expansión, y las vivas se añaden como su propio evento.
 */
function occurrencesOf(
  row: EventRow,
  window: { from: Date; to: Date },
  exceptions: EventRow[],
): EventDto[] {
  const dto = rowToDto(row);
  if (!row.recurrence) return [dto];

  const excluded = new Set(exceptions.map((e) => e.recurrence_id!.getTime()));
  const expanded = expandOccurrences(asRecurringSeries(row), window)
    .filter((o) => !excluded.has(o.startAt.getTime()))
    .map((o) => ({ ...dto, startAt: o.startAt.toISOString(), endAt: o.endAt.toISOString() }));
  const overlays = exceptions
    .filter((e) => !e.deleted && e.start_at < window.to && e.end_at > window.from)
    .map(rowToDto);
  return [...expanded, ...overlays];
}

/**
 * Eventos que se solapan con [from, to). Los recurrentes se expanden aquí en ocurrencias
 * (mismo `id` que la serie, con el inicio y fin de cada una): no existen como filas. Las
 * excepciones de una serie sustituyen su ocurrencia original (ver `occurrencesOf`).
 */
export async function listEvents(
  db: Db,
  userId: string,
  query: ListEventsQuery,
): Promise<EventDto[]> {
  const range = {
    from: new Date(query.from),
    to: new Date(query.to),
    calendarId: query.calendarId,
    categoryId: query.categoryId,
  };
  const [single, recurring] = await Promise.all([
    listSingleInRange(db, userId, range),
    listRecurringBefore(db, userId, range),
  ]);
  const exceptions = await listExceptionsForSeries(
    db,
    userId,
    recurring.map((r) => r.id),
  );
  const exceptionsBySeries = new Map<string, EventRow[]>();
  for (const e of exceptions) {
    const list = exceptionsBySeries.get(e.series_id!);
    if (list) list.push(e);
    else exceptionsBySeries.set(e.series_id!, [e]);
  }

  return [...single, ...recurring]
    .flatMap((row) => occurrencesOf(row, range, exceptionsBySeries.get(row.id) ?? []))
    .sort(
      (a, b) =>
        a.startAt.localeCompare(b.startAt) ||
        a.endAt.localeCompare(b.endAt) ||
        a.id.localeCompare(b.id),
    );
}

export async function searchEvents(
  db: Db,
  userId: string,
  { q, limit }: SearchEventsQuery,
): Promise<EventDto[]> {
  return (await searchCurrent(db, userId, q, limit)).map(rowToDto);
}

/** Eventos borrados, los más recientes primero; `updatedAt` es de cuando se borraron. */
export async function listTrash(db: Db, userId: string): Promise<EventDto[]> {
  return (await listDeletedEvents(db, userId)).map(rowToDto);
}

/** Un evento tal como está definido: si se repite, con el inicio y fin de la primera ocurrencia. */
export async function getEvent(db: Db, userId: string, id: string): Promise<EventDto> {
  const row = await findCurrent(db, userId, id);
  if (!row || row.deleted) throw new NotFoundError('Evento');
  return rowToDto(row);
}

export async function createEvent(
  db: Db,
  userId: string,
  input: CreateEventInput,
): Promise<EventDto> {
  const { calendarId, reminders, ...content } = input;
  const fields = newEventFields({
    ...content,
    startAt: new Date(content.startAt),
    endAt: new Date(content.endAt),
  });

  return withTransaction(db, async (tx) => {
    await assertCanEdit(tx, userId, calendarId);
    await assertWritable(tx, calendarId);
    if (await isArchivedCalendar(tx, calendarId)) {
      throw new ConflictError('calendar_archived', 'Este calendario está archivado');
    }
    await assertCategoryOwned(tx, userId, fields.categoryId);

    const id = await insertNewEvent(tx, userId, calendarId, fields, { reminders });
    return rowToDto((await findCurrent(tx, userId, id))!);
  });
}

export async function updateEvent(
  db: Db,
  userId: string,
  id: string,
  input: UpdateEventInput,
): Promise<EventDto> {
  const { scope, occurrenceStart, ...rest } = input;
  if (scope === 'this') {
    return updateOccurrence(db, userId, id, new Date(occurrenceStart!), rest);
  }
  if (scope === 'following') {
    return splitSeriesFrom(db, userId, id, new Date(occurrenceStart!), rest);
  }

  const { expectedVersion, changeReason, reminders, ...content } = rest;
  const patch: EventPatch = {
    ...content,
    startAt: content.startAt === undefined ? undefined : new Date(content.startAt),
    endAt: content.endAt === undefined ? undefined : new Date(content.endAt),
  };

  return withTransaction(db, async (tx) => {
    const row = await lockLiveEvent(tx, userId, id);
    await assertCanEdit(tx, userId, row.calendar_id);
    await assertWritable(tx, row.calendar_id);
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      throw new ConflictError(
        'version_conflict',
        `El evento está en la versión ${row.version}, no en la ${expectedVersion}`,
      );
    }

    const current = rowToFields(row);
    const next = applyEventPatch(current, patch);
    await assertCategoryOwned(tx, userId, next.categoryId);

    // Los recordatorios no forman parte del contenido versionado: se sustituyen aparte.
    if (reminders) await replaceReminders(tx, id, uniqueSorted(reminders));

    // Sin cambios de contenido no hay modificación, y por tanto tampoco versión nueva.
    if (!hasChanges(current, next)) return rowToDto((await findCurrent(tx, userId, id))!);

    const updated = await appendVersion(
      tx,
      row,
      { fields: next, deleted: false, changeReason: changeReason ?? null },
      userId,
    );
    return rowToDto(updated);
  });
}

/** Bloquea la serie y comprueba que `occurrenceStart` es de verdad una de sus ocurrencias. */
async function lockLiveSeries(
  tx: Queryable,
  userId: string,
  seriesId: string,
  occurrenceStart: Date,
): Promise<EventRow> {
  const row = await lockLiveEvent(tx, userId, seriesId);
  await assertCanEdit(tx, userId, row.calendar_id);
  await assertWritable(tx, row.calendar_id);
  if (!row.recurrence) throw new InvalidEventError(['scope: el evento no se repite']);

  const [occurrence] = expandOccurrences(
    asRecurringSeries(row),
    { from: occurrenceStart, to: new Date(occurrenceStart.getTime() + 1000) },
    1,
  );
  if (!occurrence || occurrence.startAt.getTime() !== occurrenceStart.getTime()) {
    throw new InvalidEventError(['occurrenceStart: no es una ocurrencia de esta serie']);
  }
  return row;
}

/** Contenido de la ocurrencia tal como la define la serie, sin repetición propia. */
function occurrenceFields(series: EventRow, occurrenceStart: Date): EventFields {
  const duration = series.end_at.getTime() - series.start_at.getTime();
  return {
    ...rowToFields(series),
    startAt: occurrenceStart,
    endAt: new Date(occurrenceStart.getTime() + duration),
    recurrence: null,
  };
}

/**
 * Edita "solo esta ocurrencia": crea (o, si ya existe, edita) la excepción de esa fecha.
 * Una excepción nunca hereda ni admite una regla de repetición propia.
 */
async function updateOccurrence(
  db: Db,
  userId: string,
  seriesId: string,
  occurrenceStart: Date,
  input: Omit<UpdateEventInput, 'scope' | 'occurrenceStart'>,
): Promise<EventDto> {
  const { expectedVersion, changeReason, reminders, ...content } = input;
  // Una excepción nunca repite: se ignora cualquier regla que llegue en el body.
  content.recurrence = undefined;

  return withTransaction(db, async (tx) => {
    const series = await lockLiveSeries(tx, userId, seriesId, occurrenceStart);
    const existing = await findExceptionRow(tx, userId, seriesId, occurrenceStart);

    if (existing) {
      if (expectedVersion !== undefined && expectedVersion !== existing.version) {
        throw new ConflictError(
          'version_conflict',
          `El evento está en la versión ${existing.version}, no en la ${expectedVersion}`,
        );
      }
      const current = rowToFields(existing);
      const patch: EventPatch = {
        ...content,
        startAt: content.startAt === undefined ? undefined : new Date(content.startAt),
        endAt: content.endAt === undefined ? undefined : new Date(content.endAt),
      };
      const next = applyEventPatch(current, patch);
      await assertCategoryOwned(tx, userId, next.categoryId);
      if (reminders) await replaceReminders(tx, existing.id, uniqueSorted(reminders));
      if (!hasChanges(current, next))
        return rowToDto((await findCurrent(tx, userId, existing.id))!);
      const updated = await appendVersion(
        tx,
        existing,
        { fields: next, deleted: false, changeReason: changeReason ?? null },
        userId,
      );
      return rowToDto(updated);
    }

    const base = occurrenceFields(series, occurrenceStart);
    const patch: EventPatch = {
      ...content,
      startAt: content.startAt === undefined ? undefined : new Date(content.startAt),
      endAt: content.endAt === undefined ? undefined : new Date(content.endAt),
    };
    const fields = applyEventPatch(base, patch);
    await assertCategoryOwned(tx, userId, fields.categoryId);
    const id = await insertNewEvent(tx, userId, series.calendar_id, fields, {
      reminders: reminders ?? series.reminders,
      changeReason: changeReason ?? undefined,
      seriesId: series.id,
      recurrenceId: occurrenceStart,
    });
    return rowToDto((await findCurrent(tx, userId, id))!);
  });
}

/** "Esta y las siguientes": parte la serie en dos por `occurrenceStart`. */
async function splitSeriesFrom(
  db: Db,
  userId: string,
  seriesId: string,
  occurrenceStart: Date,
  input: Omit<UpdateEventInput, 'scope' | 'occurrenceStart'>,
): Promise<EventDto> {
  const { expectedVersion, changeReason, reminders, ...content } = input;

  return withTransaction(db, async (tx) => {
    const series = await lockLiveSeries(tx, userId, seriesId, occurrenceStart);
    if (expectedVersion !== undefined && expectedVersion !== series.version) {
      throw new ConflictError(
        'version_conflict',
        `El evento está en la versión ${series.version}, no en la ${expectedVersion}`,
      );
    }

    const seriesFields = rowToFields(series);
    const { before, after } = splitRecurrenceAt(asRecurringSeries(series), occurrenceStart);

    if (before === null) {
      await appendVersion(
        tx,
        series,
        { fields: seriesFields, deleted: true, changeReason: 'split into a new series' },
        userId,
      );
    } else {
      await appendVersion(
        tx,
        series,
        {
          fields: { ...seriesFields, recurrence: before },
          deleted: false,
          changeReason: 'ends before the new series',
        },
        userId,
      );
    }

    const newBase: EventFields = {
      ...occurrenceFields(series, occurrenceStart),
      recurrence: after,
    };
    const patch: EventPatch = {
      ...content,
      startAt: content.startAt === undefined ? undefined : new Date(content.startAt),
      endAt: content.endAt === undefined ? undefined : new Date(content.endAt),
    };
    const newFields = applyEventPatch(newBase, patch);
    await assertCategoryOwned(tx, userId, newFields.categoryId);
    const newId = await insertNewEvent(tx, userId, series.calendar_id, newFields, {
      reminders: reminders ?? series.reminders,
      changeReason: changeReason ?? undefined,
    });

    await reassignExceptions(tx, series.id, newId, occurrenceStart);
    return rowToDto((await findCurrent(tx, userId, newId))!);
  });
}

/** Borrado lógico: añade una versión con `deleted = true`; el historial se conserva. */
export async function deleteEvent(
  db: Db,
  userId: string,
  id: string,
  query: DeleteEventQuery = {},
): Promise<void> {
  if (query.scope === 'this') {
    return deleteOccurrence(db, userId, id, new Date(query.occurrenceStart!));
  }
  if (query.scope === 'following') {
    return deleteFollowing(db, userId, id, new Date(query.occurrenceStart!));
  }
  await withTransaction(db, async (tx) => {
    const row = await lockLiveEvent(tx, userId, id);
    await assertCanEdit(tx, userId, row.calendar_id);
    await assertWritable(tx, row.calendar_id);
    await appendVersion(
      tx,
      row,
      { fields: rowToFields(row), deleted: true, changeReason: 'deleted' },
      userId,
    );
  });
}

/** Borra "solo esta ocurrencia": crea (si hace falta) la excepción ya marcada como borrada. */
async function deleteOccurrence(
  db: Db,
  userId: string,
  seriesId: string,
  occurrenceStart: Date,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const series = await lockLiveSeries(tx, userId, seriesId, occurrenceStart);
    const existing = await findExceptionRow(tx, userId, seriesId, occurrenceStart);
    if (existing) {
      if (existing.deleted) return;
      await appendVersion(
        tx,
        existing,
        { fields: rowToFields(existing), deleted: true, changeReason: 'deleted' },
        userId,
      );
      return;
    }
    await insertNewEvent(
      tx,
      userId,
      series.calendar_id,
      occurrenceFields(series, occurrenceStart),
      {
        reminders: series.reminders,
        changeReason: 'deleted',
        seriesId: series.id,
        recurrenceId: occurrenceStart,
        deleted: true,
      },
    );
  });
}

/** Borra "esta y las siguientes": trunca la serie y cancela las excepciones posteriores. */
async function deleteFollowing(
  db: Db,
  userId: string,
  seriesId: string,
  occurrenceStart: Date,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const series = await lockLiveSeries(tx, userId, seriesId, occurrenceStart);
    const { before } = splitRecurrenceAt(asRecurringSeries(series), occurrenceStart);
    const fields = rowToFields(series);

    if (before === null) {
      await appendVersion(tx, series, { fields, deleted: true, changeReason: 'deleted' }, userId);
    } else {
      await appendVersion(
        tx,
        series,
        {
          fields: { ...fields, recurrence: before },
          deleted: false,
          changeReason: 'ends before this occurrence',
        },
        userId,
      );
    }

    const trailing = await listExceptionsForSeries(tx, userId, [seriesId]);
    for (const exception of trailing) {
      if (!exception.deleted && exception.recurrence_id!.getTime() >= occurrenceStart.getTime()) {
        await appendVersion(
          tx,
          exception,
          { fields: rowToFields(exception), deleted: true, changeReason: 'series ended' },
          userId,
        );
      }
    }
  });
}

function toVersionDtos(eventId: string, rows: VersionRow[]): EventVersionDto[] {
  const currentVersion = rows.at(-1)?.version;
  return rows.map((row, i) => ({
    eventId,
    version: row.version,
    isCurrent: row.version === currentVersion,
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
    deleted: row.deleted,
    createdAt: row.created_at.toISOString(),
    changeReason: row.change_reason,
    author: row.author_name,
    changes: describeChanges(i > 0 ? rowToSnapshot(rows[i - 1]!) : null, rowToSnapshot(row)),
  }));
}

/** Historial de un evento, la versión más reciente primero. Funciona también con eventos borrados. */
export async function listVersions(
  db: Db,
  userId: string,
  eventId: string,
): Promise<EventVersionDto[]> {
  const rows = await listVersionRows(db, userId, eventId);
  if (rows.length === 0) throw new NotFoundError('Evento');
  return toVersionDtos(eventId, rows).reverse();
}

export async function getVersion(
  db: Db,
  userId: string,
  eventId: string,
  version: number,
): Promise<EventVersionDto> {
  const versions = await listVersions(db, userId, eventId);
  const found = versions.find((v) => v.version === version);
  if (!found) throw new NotFoundError('Versión');
  return found;
}

/**
 * Restaurar = crear una versión nueva con el contenido de una antigua; el historial no se
 * reescribe. También recupera un evento borrado. Si el evento ya está vivo y su contenido
 * coincide con el de la versión pedida, no hay modificación y no se crea versión. Los
 * recordatorios no se tocan: no son contenido versionado.
 */
export async function restoreVersion(
  db: Db,
  userId: string,
  id: string,
  version: number,
  expectedVersion?: number,
): Promise<EventDto> {
  return withTransaction(db, async (tx) => {
    const row = await findCurrent(tx, userId, id, { lock: true });
    if (!row) throw new NotFoundError('Evento');
    await assertCanEdit(tx, userId, row.calendar_id);
    await assertWritable(tx, row.calendar_id);
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      throw new ConflictError(
        'version_conflict',
        `El evento está en la versión ${row.version}, no en la ${expectedVersion}`,
      );
    }

    const target = await findVersionRow(tx, userId, id, version);
    if (!target) throw new NotFoundError('Versión');

    const fields = rowToFields(target);
    if (!row.deleted && !hasChanges(rowToFields(row), fields)) return rowToDto(row);

    const restored = await appendVersion(
      tx,
      row,
      { fields, deleted: false, changeReason: `restored from version ${version}` },
      userId,
    );
    return rowToDto(restored);
  });
}
