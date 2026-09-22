// Cola de escritura sin conexión (T-13): crear, editar y borrar un evento suelto (sin
// repetición) funciona sin red, guardado en este dispositivo, y se envía solo al volver la
// conexión. Ver docs/decisions/016-offline-write-queue.md para el diseño completo.
//
// Simplificación deliberada: como mucho una operación pendiente por evento («la última
// gana»); a mitad camino de una serie no hay nada que valga (ni crearla, ni tocar una
// ocurrencia) porque un ordenador sin red no puede saber qué ocurrencias existen ya en el
// servidor.
import { ApiError, api } from '../api.ts';
import type { CreateEventInput, EditScope, EventDto, UpdateEventInput } from '@calendar/shared';

/** Un cambio que no se puede poner en la cola (implica una serie): se avisa, no se guarda. */
export class OfflineUnsupportedError extends Error {}

type DeleteScope = { scope: EditScope; occurrenceStart: string };

type Send =
  | { kind: 'create'; input: CreateEventInput }
  | { kind: 'update'; id: string; input: UpdateEventInput }
  | { kind: 'delete'; id: string; scope?: DeleteScope };

export interface QueueOp {
  /** `temp:<uuid>` (evento creado sin conexión) o `real:<id>` (evento que ya existía). */
  key: string;
  createdAt: string;
  /** Cómo mostrarlo mientras está pendiente; para un borrado, el contenido justo antes. */
  display: EventDto;
  send: Send;
}

export interface ConflictEntry {
  id: string;
  createdAt: string;
  op: QueueOp;
  /** Por qué no se pudo aplicar al volver la conexión. */
  reason: string;
}

const opsKey = (userId: string) => `offlineQueue:${userId}`;
const conflictsKey = (userId: string) => `offlineConflicts:${userId}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sin persistencia: el estado sigue en memoria hasta recargar
  }
}

export function listOps(userId: string): QueueOp[] {
  return readJson(opsKey(userId), []);
}

export function listConflicts(userId: string): ConflictEntry[] {
  return readJson(conflictsKey(userId), []);
}

function writeOps(userId: string, ops: QueueOp[]): void {
  writeJson(opsKey(userId), ops);
}

function writeConflicts(userId: string, conflicts: ConflictEntry[]): void {
  writeJson(conflictsKey(userId), conflicts);
}

function assertSupported(recurrence: unknown, scope: EditScope | undefined): void {
  if (recurrence !== undefined && recurrence !== null) {
    throw new OfflineUnsupportedError(
      'Sin conexión no se pueden crear series, solo eventos sueltos.',
    );
  }
  if (scope !== undefined && scope !== 'series') {
    throw new OfflineUnsupportedError(
      'Sin conexión no se puede tocar solo una ocurrencia de una serie.',
    );
  }
}

/**
 * Añade, sustituye o quita (si `build` devuelve null) la operación pendiente de un evento;
 * conserva el orden de creación. Devuelve el resultado, para que quien llama no tenga que
 * volver a leer la cola.
 */
function upsert(
  userId: string,
  key: string,
  build: (previous: QueueOp | null) => QueueOp | null,
): QueueOp | null {
  const ops = listOps(userId);
  const index = ops.findIndex((op) => op.key === key);
  const next = build(index === -1 ? null : ops[index]!);
  if (index === -1) {
    if (next) ops.push(next);
  } else if (next) {
    ops[index] = next;
  } else {
    ops.splice(index, 1);
  }
  writeOps(userId, ops);
  return next;
}

export function enqueueCreate(userId: string, input: CreateEventInput): QueueOp {
  assertSupported(input.recurrence, undefined);
  const tempId = `offline:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const display: EventDto = {
    id: tempId,
    calendarId: input.calendarId,
    seriesId: null,
    recurrenceId: null,
    version: 1,
    title: input.title,
    description: input.description ?? '',
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timezone,
    allDay: input.allDay ?? false,
    location: input.location ?? '',
    status: input.status ?? 'confirmed',
    color: input.color ?? null,
    recurrence: null,
    categoryId: input.categoryId ?? null,
    reminders: input.reminders ?? [],
    createdAt: now,
    updatedAt: now,
  };
  const op: QueueOp = {
    key: `temp:${tempId}`,
    createdAt: now,
    display,
    send: { kind: 'create', input },
  };
  upsert(userId, op.key, () => op);
  return op;
}

/** `current` es el contenido conocido antes de este cambio (para la vista optimista). */
export function enqueueUpdate(userId: string, current: EventDto, input: UpdateEventInput): QueueOp {
  assertSupported(current.recurrence ?? input.recurrence, input.scope);
  const isTemp = current.id.startsWith('offline:');
  const key = isTemp ? `temp:${current.id}` : `real:${current.id}`;
  const now = new Date().toISOString();

  const op = upsert(userId, key, (previous) => {
    if (previous?.send.kind === 'create') {
      // Aún no existe en el servidor: se corrige lo que se va a crear, sin tocar la API.
      // Solo los campos de contenido; `expectedVersion`/`scope`/`changeReason` no pintan
      // nada en un POST /events (que además rechaza campos que no reconoce).
      const patch = toCreateFields(stripUndefined(input));
      return {
        ...previous,
        display: { ...previous.display, ...patch, updatedAt: now },
        send: { kind: 'create', input: { ...previous.send.input, ...patch } },
      };
    }
    const base: UpdateEventInput =
      previous?.send.kind === 'update'
        ? { ...previous.send.input, ...stripUndefined(input) }
        : // La primera vez: `expectedVersion` fija la versión de la que partimos.
          { ...stripUndefined(input), expectedVersion: current.version };
    return {
      key,
      createdAt: previous?.createdAt ?? now,
      display: { ...current, ...stripUndefined(input), updatedAt: now },
      send: { kind: 'update', id: current.id, input: base },
    };
  });
  return op!;
}

export function enqueueDelete(
  userId: string,
  current: EventDto,
  scope?: DeleteScope,
): QueueOp | null {
  assertSupported(current.recurrence, scope?.scope);
  const isTemp = current.id.startsWith('offline:');
  const key = isTemp ? `temp:${current.id}` : `real:${current.id}`;
  const now = new Date().toISOString();

  return upsert(userId, key, (previous) => {
    // Creado y borrado sin haber llegado a existir en el servidor: no queda nada que hacer.
    if (previous?.send.kind === 'create') return null;
    return {
      key,
      createdAt: previous?.createdAt ?? now,
      display: previous?.display ?? current,
      send: { kind: 'delete', id: current.id, scope },
    };
  });
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Campos de `UpdateEventInput` que también existen en `CreateEventInput`; descarta el resto
 * (`expectedVersion`, `changeReason`, `scope`, `occurrenceStart`), que `POST /events` rechaza. */
const CREATE_FIELDS = [
  'title',
  'description',
  'startAt',
  'endAt',
  'timezone',
  'allDay',
  'location',
  'status',
  'color',
  'recurrence',
  'categoryId',
  'reminders',
] as const satisfies readonly (keyof CreateEventInput)[];

function toCreateFields(input: Partial<UpdateEventInput>): Partial<CreateEventInput> {
  return Object.fromEntries(
    CREATE_FIELDS.filter((field) => field in input).map((field) => [field, input[field]]),
  ) as Partial<CreateEventInput>;
}

/** Eventos pendientes que hay que superponer a lo que devuelve el servidor. */
export function overlayEvents(userId: string, events: EventDto[]): EventDto[] {
  const ops = listOps(userId);
  if (ops.length === 0) return events;
  const hidden = new Set<string>();
  const overlay = new Map<string, EventDto>();
  for (const op of ops) {
    if (op.send.kind === 'delete') hidden.add(op.send.id);
    else overlay.set(op.display.id, op.display);
  }
  const base = events.filter((e) => !hidden.has(e.id) && !overlay.has(e.id));
  return [...base, ...overlay.values()];
}

/**
 * Envía lo pendiente; lo que no se pudo aplicar por un conflicto real pasa a
 * `listConflicts`. Cada operación se quita de la cola justo después de que la API responda
 * (no todas de golpe al final): si la página se cierra o se recarga a mitad de un envío con
 * varias operaciones pendientes, las que ya se habían enviado no se repiten.
 */
export async function drainQueue(
  userId: string,
): Promise<{ synced: number; conflicts: ConflictEntry[] }> {
  const newConflicts: ConflictEntry[] = [];
  let synced = 0;

  for (const op of listOps(userId)) {
    try {
      if (op.send.kind === 'create') await api.createEvent(op.send.input);
      else if (op.send.kind === 'update') await api.updateEvent(op.send.id, op.send.input);
      else await api.deleteEvent(op.send.id, op.send.scope);
      synced++;
      removeOp(userId, op.key);
    } catch (err) {
      const apiErr = asApiError(err);
      if (!apiErr) {
        // Sigue sin red: se deja donde está, se reintenta la próxima vez.
        continue;
      }
      removeOp(userId, op.key);
      if (op.send.kind === 'delete' && apiErr.status === 404) {
        synced++; // ya no existía: el fin buscado (que no exista) ya está conseguido
      } else {
        const conflict: ConflictEntry = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          op,
          reason: apiErr.userMessage,
        };
        newConflicts.push(conflict);
        writeConflicts(userId, [...listConflicts(userId), conflict]);
      }
    }
  }

  return { synced, conflicts: newConflicts };
}

function removeOp(userId: string, key: string): void {
  writeOps(
    userId,
    listOps(userId).filter((op) => op.key !== key),
  );
}

function asApiError(err: unknown): ApiError | null {
  return err instanceof ApiError ? err : null;
}

export function discardConflict(userId: string, id: string): void {
  writeConflicts(
    userId,
    listConflicts(userId).filter((c) => c.id !== id),
  );
}

/** Reintenta un conflicto (con la versión más reciente, si es una edición) o lo deja de nuevo
 * en `listConflicts` con el motivo actualizado. */
export async function retryConflict(userId: string, id: string): Promise<boolean> {
  const conflicts = listConflicts(userId);
  const conflict = conflicts.find((c) => c.id === id);
  if (!conflict) return false;
  const { op } = conflict;
  try {
    if (op.send.kind === 'create') {
      await api.createEvent(op.send.input);
    } else if (op.send.kind === 'update') {
      const latest = await api.getEvent(op.send.id);
      await api.updateEvent(op.send.id, { ...op.send.input, expectedVersion: latest.version });
    } else {
      await api.deleteEvent(op.send.id, op.send.scope);
    }
    writeConflicts(
      userId,
      conflicts.filter((c) => c.id !== id),
    );
    return true;
  } catch (err) {
    const apiErr = asApiError(err);
    writeConflicts(
      userId,
      conflicts.map((c) => (c.id === id ? { ...c, reason: apiErr?.userMessage ?? c.reason } : c)),
    );
    return false;
  }
}

export function pendingCount(userId: string): number {
  return listOps(userId).length;
}
