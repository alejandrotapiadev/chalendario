import { applyEventPatch, hasChanges, newEventFields, type EventPatch } from '@calendar/domain';
import type {
  CreateEventInput,
  EventDto,
  ListEventsQuery,
  UpdateEventInput,
} from '@calendar/shared';
import { withTransaction, type Db, type Queryable } from '../../db.ts';
import { ConflictError, NotFoundError } from '../../errors.ts';
import { calendarBelongsToUser } from '../calendars/calendars.repository.ts';
import {
  findCurrent,
  insertEvent,
  insertVersion,
  listCurrentInRange,
  rowToDto,
  rowToFields,
  setCurrentVersion,
  type EventRow,
} from './events.repository.ts';

// Regla del proyecto (ADR-002): cada modificación de un evento crea una versión nueva y
// las versiones nunca se modifican. Todas las escrituras de este servicio pasan por
// `appendVersion`, dentro de una transacción con la fila del evento bloqueada.

async function appendVersion(
  tx: Queryable,
  row: EventRow,
  next: { fields: ReturnType<typeof rowToFields>; deleted: boolean; changeReason: string | null },
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

/** Evento existente, no borrado y bloqueado para escritura; 404 en cualquier otro caso. */
async function lockLiveEvent(tx: Queryable, userId: string, id: string): Promise<EventRow> {
  const row = await findCurrent(tx, userId, id, { lock: true });
  if (!row || row.deleted) throw new NotFoundError('Evento');
  return row;
}

export async function listEvents(
  db: Db,
  userId: string,
  query: ListEventsQuery,
): Promise<EventDto[]> {
  const rows = await listCurrentInRange(db, userId, {
    from: new Date(query.from),
    to: new Date(query.to),
    calendarId: query.calendarId,
  });
  return rows.map(rowToDto);
}

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
  const { calendarId, ...content } = input;
  const fields = newEventFields({
    ...content,
    startAt: new Date(content.startAt),
    endAt: new Date(content.endAt),
  });

  return withTransaction(db, async (tx) => {
    if (!(await calendarBelongsToUser(tx, userId, calendarId))) {
      throw new NotFoundError('Calendario');
    }
    const id = await insertEvent(tx, calendarId);
    await insertVersion(tx, {
      eventId: id,
      version: 1,
      fields,
      deleted: false,
      createdBy: userId,
      changeReason: null,
    });
    return rowToDto((await findCurrent(tx, userId, id))!);
  });
}

export async function updateEvent(
  db: Db,
  userId: string,
  id: string,
  input: UpdateEventInput,
): Promise<EventDto> {
  const { expectedVersion, changeReason, ...content } = input;
  const patch: EventPatch = {
    ...content,
    startAt: content.startAt === undefined ? undefined : new Date(content.startAt),
    endAt: content.endAt === undefined ? undefined : new Date(content.endAt),
  };

  return withTransaction(db, async (tx) => {
    const row = await lockLiveEvent(tx, userId, id);
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      throw new ConflictError(
        'version_conflict',
        `El evento está en la versión ${row.version}, no en la ${expectedVersion}`,
      );
    }

    const current = rowToFields(row);
    const next = applyEventPatch(current, patch);
    // Sin cambios reales no hay modificación, y por tanto tampoco versión nueva.
    if (!hasChanges(current, next)) return rowToDto(row);

    const updated = await appendVersion(
      tx,
      row,
      { fields: next, deleted: false, changeReason: changeReason ?? null },
      userId,
    );
    return rowToDto(updated);
  });
}

/** Borrado lógico: añade una versión con `deleted = true`; el historial se conserva. */
export async function deleteEvent(db: Db, userId: string, id: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    const row = await lockLiveEvent(tx, userId, id);
    await appendVersion(
      tx,
      row,
      { fields: rowToFields(row), deleted: true, changeReason: 'deleted' },
      userId,
    );
  });
}
