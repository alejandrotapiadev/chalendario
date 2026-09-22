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
  /** 1ª–4ª (o -1 = última) ocurrencia del día de la semana del inicio; solo monthly/yearly. */
  bySetPos: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)])
    .optional(),
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

/**
 * Alcance de una edición o un borrado sobre un evento de una serie: toda la serie (por
 * defecto), solo la ocurrencia indicada, o esa ocurrencia y las siguientes (parte la serie
 * en dos). Con `this`/`following` hace falta `occurrenceStart`.
 */
export const EDIT_SCOPES = ['series', 'this', 'following'] as const;
export type EditScope = (typeof EDIT_SCOPES)[number];

const scopeFields = {
  scope: z.enum(EDIT_SCOPES).optional(),
  /** Inicio (ISO) de la ocurrencia original a la que se aplica `scope`. */
  occurrenceStart: instant.optional(),
};

const requiresOccurrenceStart = (value: { scope?: EditScope; occurrenceStart?: string }) =>
  !value.scope || value.scope === 'series' || value.occurrenceStart !== undefined;
const OCCURRENCE_START_REQUIRED = {
  message: 'occurrenceStart es obligatorio con scope "this" o "following"',
  path: ['occurrenceStart'],
};

export const updateEventSchema = z
  .strictObject({
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
    ...scopeFields,
  })
  .refine(requiresOccurrenceStart, OCCURRENCE_START_REQUIRED);
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const deleteEventQuerySchema = z
  .strictObject(scopeFields)
  .refine(requiresOccurrenceStart, OCCURRENCE_START_REQUIRED);
export type DeleteEventQuery = z.infer<typeof deleteEventQuerySchema>;

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
  /** Serie recurrente a la que pertenece, si este evento es una excepción de esa serie. */
  seriesId: string | null;
  /** Instante original de la ocurrencia que esta excepción sustituye, o null si no lo es. */
  recurrenceId: string | null;
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
  /** Quién hizo este cambio (relevante en calendarios compartidos). */
  author: string | null;
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
