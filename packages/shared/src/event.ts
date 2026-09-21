import { z } from 'zod';
import { EVENT_STATUSES, type EventStatus, type FieldChange } from '@calendar/domain';

// Aquí solo se valida la forma de los datos. Las reglas de negocio (título no vacío,
// fin posterior al inicio, medianoche local en eventos de todo el día…) viven en
// @calendar/domain y se aplican en el servidor.

/** Instante ISO 8601 con zona: `2026-09-21T10:00:00Z` o `2026-09-21T12:00:00+02:00`. */
const instant = z.iso.datetime({ offset: true });

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

export interface EventDto {
  id: string;
  calendarId: string;
  /** Serie recurrente a la que pertenece (fase 3). */
  seriesId: string | null;
  /** Número de la versión vigente (ver ADR-002). */
  version: number;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location: string;
  status: EventStatus;
  color: string | null;
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
  /** Esta versión marca el evento como borrado. */
  deleted: boolean;
  createdAt: string;
  /** Motivo del cambio: `deleted`, `restored from version N`, o el que indicó el usuario. */
  changeReason: string | null;
  /** Qué cambió respecto a la versión anterior (vacío en la versión 1). */
  changes: FieldChange[];
}
