import { isLocalMidnight, isValidTimezone } from './timezone.ts';

export const EVENT_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_LIMITS = {
  titleMax: 200,
  descriptionMax: 10_000,
  locationMax: 500,
} as const;

export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Contenido de un evento en un momento dado, es decir, lo que guarda cada versión.
 *
 * Los eventos de todo el día (`allDay`) se representan igual que los demás, como dos
 * instantes: `startAt` es la medianoche local del primer día y `endAt` la medianoche local
 * del día siguiente al último (fin exclusivo), ambas en `timezone`.
 */
export interface EventFields {
  title: string;
  description: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  allDay: boolean;
  location: string;
  status: EventStatus;
  color: string | null;
}

export type EventPatch = Partial<EventFields>;

export type NewEventInput = Pick<EventFields, 'title' | 'startAt' | 'endAt' | 'timezone'> &
  Partial<EventFields>;

export class InvalidEventError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Evento inválido: ${issues.join('; ')}`);
    this.name = 'InvalidEventError';
    this.issues = issues;
  }
}

/** Devuelve la lista de invariantes incumplidas (vacía si el evento es válido). */
export function validateEventFields(fields: EventFields): string[] {
  const issues: string[] = [];

  if (fields.title.trim().length === 0) issues.push('title: no puede estar vacío');
  if (fields.title.length > EVENT_LIMITS.titleMax) {
    issues.push(`title: máximo ${EVENT_LIMITS.titleMax} caracteres`);
  }
  if (fields.description.length > EVENT_LIMITS.descriptionMax) {
    issues.push(`description: máximo ${EVENT_LIMITS.descriptionMax} caracteres`);
  }
  if (fields.location.length > EVENT_LIMITS.locationMax) {
    issues.push(`location: máximo ${EVENT_LIMITS.locationMax} caracteres`);
  }
  if (!EVENT_STATUSES.includes(fields.status)) issues.push('status: valor desconocido');
  if (fields.color !== null && !COLOR_PATTERN.test(fields.color)) {
    issues.push('color: debe tener el formato #rrggbb');
  }

  const validTimezone = isValidTimezone(fields.timezone);
  if (!validTimezone) issues.push('timezone: zona horaria IANA desconocida');

  const startValid = !Number.isNaN(fields.startAt.getTime());
  const endValid = !Number.isNaN(fields.endAt.getTime());
  if (!startValid) issues.push('startAt: fecha inválida');
  if (!endValid) issues.push('endAt: fecha inválida');
  if (startValid && endValid && fields.endAt <= fields.startAt) {
    issues.push('endAt: debe ser posterior a startAt');
  }

  if (fields.allDay && validTimezone && startValid && endValid) {
    if (!isLocalMidnight(fields.startAt, fields.timezone)) {
      issues.push('startAt: un evento de todo el día debe empezar a medianoche local');
    }
    if (!isLocalMidnight(fields.endAt, fields.timezone)) {
      issues.push('endAt: un evento de todo el día debe acabar a medianoche local');
    }
  }

  return issues;
}

function normalize(fields: EventFields): EventFields {
  return { ...fields, title: fields.title.trim() };
}

function assertValid(fields: EventFields): EventFields {
  const normalized = normalize(fields);
  const issues = validateEventFields(normalized);
  if (issues.length > 0) throw new InvalidEventError(issues);
  return normalized;
}

/** Construye el contenido de un evento nuevo aplicando valores por defecto y validando. */
export function newEventFields(input: NewEventInput): EventFields {
  return assertValid({
    description: '',
    allDay: false,
    location: '',
    status: 'confirmed',
    color: null,
    ...withoutUndefined(input),
  });
}

/**
 * Aplica un cambio parcial sobre el contenido actual y valida el resultado completo.
 * Un campo `undefined` significa «no tocar»; `color: null` significa «quitar el color».
 */
export function applyEventPatch(current: EventFields, patch: EventPatch): EventFields {
  return assertValid({ ...current, ...withoutUndefined(patch) });
}

export function hasChanges(a: EventFields, b: EventFields): boolean {
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    a.startAt.getTime() !== b.startAt.getTime() ||
    a.endAt.getTime() !== b.endAt.getTime() ||
    a.timezone !== b.timezone ||
    a.allDay !== b.allDay ||
    a.location !== b.location ||
    a.status !== b.status ||
    a.color !== b.color
  );
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
