// Utilidades de fechas en la zona horaria elegida para ver el calendario (T-10; por
// defecto, la del navegador). La semana empieza en lunes.

import { wallClock, zonedTimeToInstant } from '@calendar/domain';

export type ViewMode = 'month' | 'week' | 'day';

export const LOCALE = 'es-ES';

/**
 * Un instante real, tal como lo lee la cuadrícula: un `Date` cuyos getters «locales»
 * (`getFullYear`, `getHours`…) devuelven la hora de pared en `timeZone` en vez de la del
 * navegador. Solo sirve para pintar y para las cuentas de arrastrar/redimensionar (que ya
 * solo usan esos getters): no es un instante real, así que nunca se manda tal cual a la
 * API ni se compara con `new Date()` (ver `fromDisplay`).
 */
export function toDisplay(iso: string, timeZone: string): Date {
  const { year, month, day, hour, minute, second } = wallClock(new Date(iso), timeZone);
  return new Date(year, month - 1, day, hour, minute, second);
}

/** Inversa de `toDisplay`: del «Date de pantalla» que resulta de arrastrar o crear, a su
 * instante real (para mandarlo a la API). */
export function fromDisplay(date: Date, timeZone: string): Date {
  return zonedTimeToInstant(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    timeZone,
  );
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Suma días de calendario (no de 24 h), así que respeta los cambios de hora. */
export function addDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

/** Suma meses limitando el día al último del mes destino (31 ene + 1 mes = 28/29 feb). */
export function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    Math.min(date.getDate(), lastDay),
    date.getHours(),
    date.getMinutes(),
  );
}

export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const sinceMonday = (day.getDay() + 6) % 7;
  return addDays(day, -sinceMonday);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Los 42 días (6 semanas) de la cuadrícula del mes que contiene `cursor`. */
export function monthGridDays(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDays(cursor: Date): Date[] {
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Rango visible [from, to) de una vista: es lo que se pide a la API. */
export function visibleRange(view: ViewMode, cursor: Date): { from: Date; to: Date } {
  if (view === 'month') {
    const days = monthGridDays(cursor);
    return { from: days[0]!, to: addDays(days[41]!, 1) };
  }
  if (view === 'week') {
    const from = startOfWeek(cursor);
    return { from, to: addDays(from, 7) };
  }
  const from = startOfDay(cursor);
  return { from, to: addDays(from, 1) };
}

export function shiftCursor(view: ViewMode, cursor: Date, direction: -1 | 1): Date {
  if (view === 'month') return addMonths(cursor, direction);
  return addDays(cursor, direction * (view === 'week' ? 7 : 1));
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function viewTitle(view: ViewMode, cursor: Date): string {
  if (view === 'month') {
    return capitalize(
      new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(cursor),
    );
  }
  if (view === 'day') {
    return capitalize(
      new Intl.DateTimeFormat(LOCALE, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(cursor),
    );
  }
  const days = weekDays(cursor);
  const first = days[0]!;
  const last = days[6]!;
  const day = (d: Date) => d.getDate();
  const month = (d: Date) => new Intl.DateTimeFormat(LOCALE, { month: 'short' }).format(d);
  const sameMonth = first.getMonth() === last.getMonth();
  const range = sameMonth
    ? `${day(first)} – ${day(last)} ${month(last)}`
    : `${day(first)} ${month(first)} – ${day(last)} ${month(last)}`;
  return `${range} ${last.getFullYear()}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` para <input type="date"> (en hora local). */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:mm` para <input type="time"> (en hora local). */
export function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Fecha local a partir de los valores de <input type="date"> y <input type="time">. */
export function fromInputs(date: string, time = '00:00'): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y!, mo! - 1, d!, h ?? 0, mi ?? 0);
}

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Días de calendario de `a` a `b` (con signo). Robusto ante los cambios de hora. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

/** Día de la semana con lunes = 0 … domingo = 6 (como en las reglas de repetición). */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** 1ª-4ª ocurrencia del día de la semana de `date` dentro de su mes (para `bySetPos`). */
export function weekdayOrdinalInMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

/** Si `date` es la última ocurrencia de su día de la semana dentro de su mes. */
export function isLastWeekdayInMonth(date: Date): boolean {
  const lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() + 7 > lastOfMonth;
}
