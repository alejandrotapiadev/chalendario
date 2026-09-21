import { addDays } from './dates.ts';

export const SNAP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;
const MINUTE_MS = 60_000;

/** Redondea al múltiplo más cercano de `step` minutos. */
export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  // `+ 0` evita devolver -0 (Math.round(-0.2) === -0), que rompería las comparaciones.
  return Math.round(minutes / step) * step + 0;
}

function addWallMinutes(date: Date, minutes: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes() + minutes,
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export interface Span {
  start: Date;
  end: Date;
}

/**
 * Mueve un evento `dayDelta` días de calendario y `minuteDelta` minutos. Los eventos con
 * hora conservan su duración exacta aunque haya un cambio de hora por medio; los de todo
 * el día se desplazan por días y siguen empezando y acabando a medianoche local.
 */
export function moveSpan(
  { start, end }: Span,
  allDay: boolean,
  dayDelta: number,
  minuteDelta = 0,
): Span {
  if (allDay) return { start: addDays(start, dayDelta), end: addDays(end, dayDelta) };
  const movedStart = addWallMinutes(addDays(start, dayDelta), minuteDelta);
  return {
    start: movedStart,
    end: new Date(movedStart.getTime() + (end.getTime() - start.getTime())),
  };
}

/** Cambia el fin `minuteDelta` minutos, sin bajar de la duración mínima. */
export function resizeSpan({ start, end }: Span, minuteDelta: number): Span {
  const minEnd = start.getTime() + MIN_DURATION_MINUTES * MINUTE_MS;
  return { start, end: new Date(Math.max(addWallMinutes(end, minuteDelta).getTime(), minEnd)) };
}

export function sameSpan(a: Span, b: Span): boolean {
  return a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();
}
