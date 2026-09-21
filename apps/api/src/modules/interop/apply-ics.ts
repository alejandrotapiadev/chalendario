import { createHash } from 'node:crypto';
import {
  InvalidEventError,
  hasChanges,
  newEventFields,
  type IcsParseResult,
  type ParsedIcsEvent,
} from '@calendar/domain';
import type { ImportResultDto } from '@calendar/shared';
import type { Queryable } from '../../db.ts';
import {
  eventExistsInCalendar,
  findCurrent,
  findEventIdByUid,
  listLiveUidRows,
  replaceReminders,
  rowToFields,
} from '../events/events.repository.ts';
import { appendVersion, insertNewEvent } from '../events/events.service.ts';

/** UID que usa la app al exportar un evento creado aquí (no tiene UID externo). */
export const OWN_UID_SUFFIX = '@personal-calendar';
const OWN_UID = new RegExp(`^([0-9a-f-]{36})${OWN_UID_SUFFIX.replace('.', '\\.')}$`, 'i');

/** UID estable para un evento que el fichero no identifica, para no duplicarlo al reimportar. */
function syntheticUid(e: ParsedIcsEvent): string {
  const f = e.fields;
  const key = [f.title, f.startAt.toISOString(), f.endAt.toISOString(), f.allDay ? 1 : 0].join('|');
  return `synthetic-${createHash('sha1').update(key).digest('hex')}@import`;
}

/** Evento del calendario que corresponde a un UID: por UID externo o, si es nuestro, por id. */
async function findExisting(
  tx: Queryable,
  calendarId: string,
  uid: string,
): Promise<string | null> {
  const byUid = await findEventIdByUid(tx, calendarId, uid);
  if (byUid) return byUid;
  const own = OWN_UID.exec(uid);
  return own && (await eventExistsInCalendar(tx, calendarId, own[1]!.toLowerCase()))
    ? own[1]!.toLowerCase()
    : null;
}

export interface ApplyOptions {
  userId: string;
  calendarId: string;
  parsed: IcsParseResult;
  /** Nombre (en minúsculas) → id de las categorías del usuario. */
  categories: Map<string, string>;
  /** `import` o `sync`: queda como motivo en el historial de cada evento tocado. */
  reason: 'import' | 'sync';
  /** Espejo: los eventos del calendario que ya no están en el fichero se borran. */
  mirror: boolean;
}

/**
 * Aplica un `.ics` ya leído a un calendario, dentro de la transacción dada. Cada evento se
 * identifica por su UID: si no existe se crea, si cambió se añade una versión (así el
 * historial y «deshacer» funcionan igual que con una edición) y si es idéntico no se toca.
 */
export async function applyParsedIcs(tx: Queryable, opts: ApplyOptions): Promise<ImportResultDto> {
  const { userId, calendarId, parsed, categories, reason } = opts;
  const result: ImportResultDto = {
    created: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    skipped: [...parsed.skipped],
    warnings: [...parsed.warnings],
  };
  const seen = new Set<string>();
  const unknownCategories = new Set<string>();

  for (const parsedEvent of parsed.events) {
    const uid = parsedEvent.uid ?? syntheticUid(parsedEvent);
    if (seen.has(uid)) {
      result.skipped.push({
        title: parsedEvent.fields.title,
        reason: 'UID repetido en el fichero',
      });
      continue;
    }
    seen.add(uid);

    let categoryId: string | null | undefined; // undefined = el fichero no dice nada
    if (parsedEvent.categoryName) {
      categoryId = categories.get(parsedEvent.categoryName.toLowerCase());
      if (!categoryId) unknownCategories.add(parsedEvent.categoryName);
    }

    let fields;
    try {
      fields = newEventFields({ ...parsedEvent.fields, categoryId: categoryId ?? null });
    } catch (err) {
      if (!(err instanceof InvalidEventError)) throw err;
      result.skipped.push({ title: parsedEvent.fields.title, reason: err.issues.join('; ') });
      continue;
    }

    const existingId = await findExisting(tx, calendarId, uid);
    if (!existingId) {
      await insertNewEvent(tx, userId, calendarId, fields, {
        reminders: parsedEvent.reminders,
        uid,
        changeReason: reason,
      });
      result.created++;
      continue;
    }

    const row = (await findCurrent(tx, userId, existingId, { lock: true }))!;
    // Si el fichero no trae categoría, se respeta la que ya tuviera el evento.
    if (categoryId === undefined) fields = { ...fields, categoryId: row.category_id };

    if (row.deleted || hasChanges(rowToFields(row), fields)) {
      await appendVersion(tx, row, { fields, deleted: false, changeReason: reason }, userId);
      result.updated++;
    } else {
      result.unchanged++;
    }
    if (parsedEvent.reminders.length > 0)
      await replaceReminders(tx, existingId, parsedEvent.reminders);
  }

  if (unknownCategories.size > 0) {
    result.warnings.push(
      `Categorías que no existen (se ignoraron): ${[...unknownCategories].join(', ')}.`,
    );
  }

  if (opts.mirror) {
    for (const { id, uid } of await listLiveUidRows(tx, calendarId)) {
      if (seen.has(uid)) continue;
      const row = (await findCurrent(tx, userId, id, { lock: true }))!;
      await appendVersion(
        tx,
        row,
        { fields: rowToFields(row), deleted: true, changeReason: reason },
        userId,
      );
      result.removed++;
    }
  }
  return result;
}
