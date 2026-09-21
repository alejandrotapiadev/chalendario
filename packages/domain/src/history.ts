import type { EventFields } from './event.ts';

/** Contenido de una versión: los campos del evento más su marca de borrado (ADR-005). */
export interface EventSnapshot extends EventFields {
  deleted: boolean;
}

export const TRACKED_FIELDS = [
  'title',
  'description',
  'startAt',
  'endAt',
  'timezone',
  'allDay',
  'location',
  'status',
  'color',
  'deleted',
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type FieldValue = string | boolean | null;

export interface FieldChange {
  field: TrackedField;
  from: FieldValue;
  to: FieldValue;
}

function comparable(snapshot: EventSnapshot, field: TrackedField): FieldValue {
  const value = snapshot[field];
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Qué cambió entre dos versiones consecutivas. Con `previous = null` (versión 1, la
 * creación) no hay cambios que describir. Las fechas se comparan por instante y se
 * devuelven como ISO 8601 en UTC.
 */
export function describeChanges(
  previous: EventSnapshot | null,
  next: EventSnapshot,
): FieldChange[] {
  if (previous === null) return [];
  const changes: FieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    const from = comparable(previous, field);
    const to = comparable(next, field);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}
