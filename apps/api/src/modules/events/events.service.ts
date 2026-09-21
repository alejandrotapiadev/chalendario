import {
  applyEventPatch,
  describeChanges,
  hasChanges,
  newEventFields,
  type EventPatch,
} from '@calendar/domain';
import type {
  CreateEventInput,
  EventDto,
  EventVersionDto,
  ListEventsQuery,
  UpdateEventInput,
} from '@calendar/shared';
import { withTransaction, type Db, type Queryable } from '../../db.ts';
import { ConflictError, NotFoundError } from '../../errors.ts';
import { calendarBelongsToUser } from '../calendars/calendars.repository.ts';
import {
  findCurrent,
  findVersionRow,
  insertEvent,
  insertVersion,
  listCurrentInRange,
  listVersionRows,
  rowToDto,
  rowToFields,
  rowToSnapshot,
  setCurrentVersion,
  type EventRow,
  type VersionRow,
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
    deleted: row.deleted,
    createdAt: row.created_at.toISOString(),
    changeReason: row.change_reason,
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
 * coincide con el de la versión pedida, no hay modificación y no se crea versión.
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
