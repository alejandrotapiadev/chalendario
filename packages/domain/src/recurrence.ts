import { isValidTimezone, wallClock, zonedTimeToInstant } from './timezone.ts';

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const RECURRENCE_LIMITS = { intervalMax: 99, countMax: 999 } as const;

/** Tope de ocurrencias devueltas por una expansión (protege de rangos enormes). */
export const MAX_OCCURRENCES_PER_EXPANSION = 1000;

/** Tope de fechas candidatas exploradas por expansión (evita bucles largos en reglas raras). */
const MAX_CANDIDATES = 50_000;

/**
 * Regla de repetición. Es un subconjunto deliberado de RRULE (RFC 5545) que se puede
 * ampliar sin migrar datos: el resto (excepciones, «segundo martes»…) llegará después.
 *
 * - `interval`: cada N días/semanas/meses.
 * - `byWeekday`: solo en `weekly`; 0 = lunes … 6 = domingo. Debe incluir el día del inicio.
 * - `until` (fecha `YYYY-MM-DD`, inclusive, en la zona del evento) y `count` (nº total de
 *   ocurrencias, contando la primera) son excluyentes; sin ninguno, no termina nunca.
 * - `monthly` repite el mismo día del mes; los meses que no lo tienen (30/31, 29 feb) se
 *   saltan, como en iCalendar.
 */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;
  byWeekday?: number[];
  until?: string;
  count?: number;
}

const DAY_MS = 86_400_000;
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Nº de días desde 1970-01-01 de una fecha civil (month 1–12). */
function civilToDays(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function daysToCivil(days: number) {
  const date = new Date(days * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** 0 = lunes … 6 = domingo. El 1 de enero de 1970 fue jueves. */
const weekdayOf = (days: number) => mod(days + 3, 7);

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Día (nº desde 1970) de una fecha `YYYY-MM-DD`, o null si no es una fecha válida. */
function parseCivilDate(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const days = civilToDays(year, month, day);
  const back = daysToCivil(days);
  return back.year === year && back.month === month && back.day === day ? days : null;
}

/** Día de la semana (0 = lunes) del instante en la zona dada. */
export function weekdayIn(instant: Date, timeZone: string): number {
  const { year, month, day } = wallClock(instant, timeZone);
  return weekdayOf(civilToDays(year, month, day));
}

/**
 * Forma canónica de una regla: claves en orden fijo, sin campos vacíos y, en `weekly`, con
 * los días ordenados, sin repetir y completados con el del inicio si faltaban. Así dos
 * reglas equivalentes se guardan (y comparan) igual.
 */
export function normalizeRecurrence(
  rule: RecurrenceRule,
  startWeekday: number | null,
): RecurrenceRule {
  const out: RecurrenceRule = { freq: rule.freq, interval: rule.interval };
  if (rule.freq === 'weekly') {
    const days = rule.byWeekday ?? (startWeekday === null ? [] : [startWeekday]);
    out.byWeekday = [...new Set(days)].sort((a, b) => a - b);
  } else if (rule.byWeekday !== undefined) {
    out.byWeekday = rule.byWeekday; // se conserva para que la validación lo rechace
  }
  if (rule.until !== undefined) out.until = rule.until;
  if (rule.count !== undefined) out.count = rule.count;
  return out;
}

export function recurrenceKey(rule: RecurrenceRule | null): string {
  return rule === null ? '' : JSON.stringify(rule);
}

/** Lista de invariantes incumplidas por la regla (vacía si es válida). */
export function validateRecurrence(
  rule: RecurrenceRule,
  startAt: Date,
  timeZone: string,
): string[] {
  const issues: string[] = [];
  const at = (message: string) => `recurrence: ${message}`;

  if (!RECURRENCE_FREQS.includes(rule.freq)) issues.push(at('freq desconocida'));
  if (
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > RECURRENCE_LIMITS.intervalMax
  ) {
    issues.push(at(`interval debe ser un entero entre 1 y ${RECURRENCE_LIMITS.intervalMax}`));
  }
  if (rule.until !== undefined && rule.count !== undefined) {
    issues.push(at('until y count son excluyentes'));
  }
  if (
    rule.count !== undefined &&
    (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > RECURRENCE_LIMITS.countMax)
  ) {
    issues.push(at(`count debe ser un entero entre 1 y ${RECURRENCE_LIMITS.countMax}`));
  }

  const startUsable = isValidTimezone(timeZone) && !Number.isNaN(startAt.getTime());
  let startDay: number | null = null;
  if (startUsable) {
    const { year, month, day } = wallClock(startAt, timeZone);
    startDay = civilToDays(year, month, day);
  }

  if (rule.until !== undefined) {
    const until = parseCivilDate(rule.until);
    if (until === null) issues.push(at('until debe ser una fecha YYYY-MM-DD válida'));
    else if (startDay !== null && until < startDay) {
      issues.push(at('until no puede ser anterior al inicio del evento'));
    }
  }

  if (rule.byWeekday !== undefined) {
    const days = rule.byWeekday;
    if (rule.freq !== 'weekly') {
      issues.push(at('byWeekday solo se admite con freq weekly'));
    } else if (
      days.length === 0 ||
      days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      new Set(days).size !== days.length
    ) {
      issues.push(
        at('byWeekday debe ser una lista sin repetir de días entre 0 (lunes) y 6 (domingo)'),
      );
    } else if (startDay !== null && !days.includes(weekdayOf(startDay))) {
      issues.push(at('byWeekday debe incluir el día de la semana en que empieza el evento'));
    }
  }

  return issues;
}

export interface RecurringSeries {
  startAt: Date;
  endAt: Date;
  timezone: string;
  allDay: boolean;
  recurrence: RecurrenceRule;
}

export interface Occurrence {
  startAt: Date;
  endAt: Date;
}

/** Fechas candidatas (nº de día desde 1970) en orden creciente, empezando cerca de `fromDay`. */
function* candidateDays(
  rule: RecurrenceRule,
  startDay: number,
  start: { year: number; month: number; day: number },
  fromDay: number,
): Generator<number> {
  const { interval } = rule;
  // Primer periodo a explorar: con `fromDay` finito se salta hasta uno antes de la ventana;
  // con -Infinity (regla con `count`) se empieza en el primero.
  const firstPeriod = (periods: number) =>
    Number.isFinite(fromDay) ? Math.max(0, Math.floor(periods) - 1) : 0;
  if (rule.freq === 'daily') {
    const k0 = firstPeriod((fromDay - startDay) / interval);
    for (let k = k0; ; k++) yield startDay + k * interval;
  } else if (rule.freq === 'weekly') {
    const weekdays = [...(rule.byWeekday ?? [weekdayOf(startDay)])].sort((a, b) => a - b);
    const startMonday = startDay - weekdayOf(startDay);
    const span = 7 * interval;
    const k0 = firstPeriod((fromDay - startMonday) / span);
    for (let k = k0; ; k++) {
      for (const weekday of weekdays) {
        const day = startMonday + k * span + weekday;
        if (day >= startDay) yield day;
      }
    }
  } else {
    const startIndex = start.year * 12 + (start.month - 1);
    const from = daysToCivil(fromDay);
    const fromIndex = from.year * 12 + (from.month - 1);
    const k0 = firstPeriod((fromIndex - startIndex) / interval);
    for (let k = k0; ; k++) {
      const index = startIndex + k * interval;
      const year = Math.floor(index / 12);
      const month = mod(index, 12) + 1;
      if (start.day <= daysInMonth(year, month)) yield civilToDays(year, month, start.day);
    }
  }
}

/**
 * Ocurrencias de una serie que se solapan con `[from, to)`, en orden. La hora de pared se
 * conserva en la zona del evento: una reunión «a las 10:00» sigue siendo a las 10:00 tras
 * un cambio de hora, aunque el instante UTC cambie.
 *
 * Las de duración fija (con hora) conservan su duración exacta; las de todo el día
 * conservan su número de días y siguen empezando y acabando a medianoche local.
 */
export function expandOccurrences(
  series: RecurringSeries,
  window: { from: Date; to: Date },
  limit: number = MAX_OCCURRENCES_PER_EXPANSION,
): Occurrence[] {
  const { timezone, recurrence: rule } = series;
  const start = wallClock(series.startAt, timezone);
  const startDay = civilToDays(start.year, start.month, start.day);
  const durationMs = series.endAt.getTime() - series.startAt.getTime();
  const spanDays = series.allDay
    ? (() => {
        const end = wallClock(series.endAt, timezone);
        return civilToDays(end.year, end.month, end.day) - startDay;
      })()
    : 0;

  const occurrenceOn = (day: number): Occurrence => {
    const c = daysToCivil(day);
    const startAt = zonedTimeToInstant(
      c.year,
      c.month,
      c.day,
      start.hour,
      start.minute,
      start.second,
      timezone,
    );
    if (!series.allDay) return { startAt, endAt: new Date(startAt.getTime() + durationMs) };
    const e = daysToCivil(day + spanDays);
    return { startAt, endAt: zonedTimeToInstant(e.year, e.month, e.day, 0, 0, 0, timezone) };
  };

  const until = rule.until === undefined ? null : parseCivilDate(rule.until);
  const maxCount = rule.count ?? Infinity;

  // Con `count` hay que contar desde la primera ocurrencia; sin él se puede saltar
  // directamente cerca de la ventana (con un día de margen por la duración del evento).
  let fromDay = -Infinity;
  if (rule.count === undefined) {
    const margin = new Date(window.from.getTime() - Math.max(durationMs, 0) - DAY_MS);
    const w = wallClock(margin, timezone);
    fromDay = civilToDays(w.year, w.month, w.day);
  }

  const result: Occurrence[] = [];
  let generated = 0;
  let explored = 0;
  for (const day of candidateDays(rule, startDay, start, fromDay)) {
    if (++explored > MAX_CANDIDATES) break;
    if (generated >= maxCount) break;
    if (until !== null && day > until) break;
    generated++;

    const occurrence = occurrenceOn(day);
    if (occurrence.startAt >= window.to) break;
    if (occurrence.endAt > window.from) {
      result.push(occurrence);
      if (result.length >= limit) break;
    }
  }
  return result;
}
