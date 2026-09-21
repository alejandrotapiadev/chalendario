import { z } from 'zod';
import {
  EVENT_STATUSES,
  RECURRENCE_FREQS,
  type EventStatus,
  type FieldChange,
  type RecurrenceRule,
} from '@calendar/domain';

// Aquí solo se valida la forma de los datos. Las reglas de negocio (título no vacío,
// fin posterior al inicio, medianoche local en eventos de todo el día, coherencia de la
// recurrencia…) viven en @calendar/domain y se aplican en el servidor.

/** Instante ISO 8601 con zona: `2026-09-21T10:00:00Z` o `2026-09-21T12:00:00+02:00`. */
const instant = z.iso.datetime({ offset: true });

/** Máximo de antelación de un recordatorio: 4 semanas. */
export const REMINDER_MAX_MINUTES = 40_320;
export const REMINDERS_MAX_PER_EVENT = 10;

export const recurrenceRuleSchema = z.strictObject({
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number(),
  byWeekday: z.array(z.number()).optional(),
  until: z.string().optional(),
  count: z.number().optional(),
});

/** Minutos de antelación de cada recordatorio; los repetidos se descartan en el servidor. */
const reminders = z.array(z.int().min(0).max(REMINDER_MAX_MINUTES)).max(REMINDERS_MAX_PER_EVENT);

const eventFields = {
  title: z.string(),
  description: z.string(),
  startAt: instant,
  endAt: instant,
  /** Zona horaria IANA, p. ej. `Europe/Madrid`. */
  timezone: z.string(),
  allDay: z.boolean(),
  location: z.string(),
  status: z.enum(EVENT_STATUSES),
  color: z.string().nullable(),
  recurrence: recurrenceRuleSchema.nullable(),
  categoryId: z.uuid().nullable(),
};

export const createEventSchema = z.strictObject({
  calendarId: z.uuid(),
  title: eventFields.title,
  startAt: eventFields.startAt,
  endAt: eventFields.endAt,
  timezone: eventFields.timezone,
  description: eventFields.description.optional(),
  allDay: eventFields.allDay.optional(),
  location: eventFields.location.optional(),
  status: eventFields.status.optional(),
  color: eventFields.color.optional(),
  recurrence: eventFields.recurrence.optional(),
  categoryId: eventFields.categoryId.optional(),
  reminders: reminders.optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.strictObject({
  title: eventFields.title.optional(),
  description: eventFields.description.optional(),
  startAt: eventFields.startAt.optional(),
  endAt: eventFields.endAt.optional(),
  timezone: eventFields.timezone.optional(),
  allDay: eventFields.allDay.optional(),
  location: eventFields.location.optional(),
  status: eventFields.status.optional(),
  color: eventFields.color.optional(),
  recurrence: eventFields.recurrence.optional(),
  categoryId: eventFields.categoryId.optional(),
  /** Sustituye el conjunto de recordatorios. No es contenido versionado: no crea versión. */
  reminders: reminders.optional(),
  /** Concurrencia optimista: si no coincide con la versión actual, la API responde 409. */
  expectedVersion: z.int().positive().optional(),
  changeReason: z.string().max(500).optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** Máximo rango consultable de una vez (cubre cualquier vista mes/semana/día). */
export const MAX_RANGE_DAYS = 400;

export const listEventsQuerySchema = z
  .strictObject({
    /** Inicio del rango (inclusive). */
    from: instant,
    /** Fin del rango (exclusivo). */
    to: instant,
    calendarId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
  })
  .refine(({ from, to }) => new Date(to) > new Date(from), {
    message: 'to debe ser posterior a from',
    path: ['to'],
  })
  .refine(({ from, to }) => +new Date(to) - +new Date(from) <= MAX_RANGE_DAYS * 86_400_000, {
    message: `el rango no puede superar ${MAX_RANGE_DAYS} días`,
    path: ['to'],
  });
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export const SEARCH_LIMIT_DEFAULT = 25;
export const SEARCH_LIMIT_MAX = 50;

export const searchEventsQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
});
export type SearchEventsQuery = z.infer<typeof searchEventsQuerySchema>;

export interface EventDto {
  id: string;
  calendarId: string;
  /** Serie recurrente a la que pertenece (excepciones de serie, fase posterior). */
  seriesId: string | null;
  /** Número de la versión vigente (ver ADR-002). */
  version: number;
  title: string;
  description: string;
  /**
   * En `GET /events` de un evento recurrente, inicio y fin de **esta ocurrencia**. En
   * `GET /events/:id` y las escrituras, los de la primera (los que define la serie).
   */
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location: string;
  status: EventStatus;
  color: string | null;
  /** Regla de repetición, o `null` si no se repite. */
  recurrence: RecurrenceRule | null;
  categoryId: string | null;
  /** Minutos de antelación de los recordatorios, de menor a mayor. */
  reminders: number[];
  createdAt: string;
  updatedAt: string;
}

/** Parámetros de ruta de las versiones: `/events/:id/versions/:version`. */
export const versionParamsSchema = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().positive(),
});

export const restoreEventSchema = z.strictObject({
  /** Concurrencia optimista, igual que en `updateEventSchema`. */
  expectedVersion: z.int().positive().optional(),
});
export type RestoreEventInput = z.infer<typeof restoreEventSchema>;

/** Una versión del historial de un evento. */
export interface EventVersionDto {
  eventId: string;
  version: number;
  /** Es la versión vigente del evento. */
  isCurrent: boolean;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location: string;
  status: EventStatus;
  color: string | null;
  recurrence: RecurrenceRule | null;
  categoryId: string | null;
  /** Esta versión marca el evento como borrado. */
  deleted: boolean;
  createdAt: string;
  /** Motivo del cambio: `deleted`, `restored from version N`, o el que indicó el usuario. */
  changeReason: string | null;
  /** Qué cambió respecto a la versión anterior (vacío en la versión 1). */
  changes: FieldChange[];
}

/** Recordatorio disparado: su hora ya pasó y la ocurrencia aún no ha terminado. */
export interface ReminderDto {
  eventId: string;
  title: string;
  location: string;
  allDay: boolean;
  occurrenceStartAt: string;
  occurrenceEndAt: string;
  minutesBefore: number;
  /** Cuándo debía avisar: `occurrenceStartAt` menos `minutesBefore`. */
  triggerAt: string;
}

export const activeRemindersQuerySchema = z.strictObject({
  /** Instante de referencia; por defecto, ahora. Útil para pruebas. */
  at: instant.optional(),
});
