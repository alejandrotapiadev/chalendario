import { isValidTimezone, wallClock, zonedTimeToInstant } from './timezone.ts';

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

/** 1ª, 2ª, 3ª, 4ª o última (-1) ocurrencia de un día de la semana dentro del mes. */
export const BY_SET_POS_VALUES = [1, 2, 3, 4, -1] as const;
export type BySetPos = (typeof BY_SET_POS_VALUES)[number];

export const RECURRENCE_LIMITS = { intervalMax: 99, countMax: 999 } as const;

/** Tope de ocurrencias devueltas por una expansión (protege de rangos enormes). */
export const MAX_OCCURRENCES_PER_EXPANSION = 1000;

/** Tope de fechas candidatas exploradas por expansión (evita bucles largos en reglas raras). */
const MAX_CANDIDATES = 50_000;

/**
 * Regla de repetición. Es un subconjunto deliberado de RRULE (RFC 5545) que se puede
 * ampliar sin migrar datos.
 *
 * - `interval`: cada N días/semanas/meses/años.
 * - `byWeekday`: solo en `weekly`; 0 = lunes … 6 = domingo. Debe incluir el día del inicio.
 * - `bySetPos`: solo en `monthly`/`yearly`; qué ocurrencia del día de la semana del inicio
 *   dentro del mes (1ª–4ª, o -1 = última) — «el segundo martes», «el último viernes». Sin
 *   él, `monthly`/`yearly` repiten el mismo día del mes (y, en `yearly`, el mismo mes).
 * - `until` (fecha `YYYY-MM-DD`, inclusive, en la zona del evento) y `count` (nº total de
 *   ocurrencias, contando la primera) son excluyentes; sin ninguno, no termina nunca.
 * - `monthly`/`yearly` sin `bySetPos` saltan los periodos que no tienen ese día (31, 29
 *   feb), como en iCalendar, en vez de ajustar al último día.
 */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;
  byWeekday?: number[];
  bySetPos?: BySetPos;
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

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Día (nº desde 1970) de la N-ésima (o última, con -1) ocurrencia de `weekday` en el mes. */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  pos: number,
): number | null {
  const daysInM = daysInMonth(year, month);
  if (pos > 0) {
    const firstWeekday = weekdayOf(civilToDays(year, month, 1));
    const day = 1 + mod(weekday - firstWeekday, 7) + (pos - 1) * 7;
    return day <= daysInM ? civilToDays(year, month, day) : null;
  }
  const lastWeekday = weekdayOf(civilToDays(year, month, daysInM));
  return civilToDays(year, month, daysInM - mod(lastWeekday - weekday, 7));
}

/** Qué ocurrencia (1ª, 2ª…) de su día de la semana es `day` dentro de su mes. */
function ordinalOfWeekdayInMonth(day: number): number {
  return Math.floor((daysToCivil(day).day - 1) / 7) + 1;
}

/** Si `day` es la última ocurrencia de su día de la semana en su mes. */
function isLastWeekdayOfMonth(day: number): boolean {
  const { year, month, day: dom } = daysToCivil(day);
  return dom + 7 > daysInMonth(year, month);
}

/** Fecha `YYYY-MM-DD` de un nº de día desde 1970. */
function formatCivilDate(days: number): string {
  const { year, month, day } = daysToCivil(days);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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
 * Qué ocurrencia de su día de la semana es `instant` dentro de su mes, en la zona dada:
 * 1-4, o -1 si además es la última (mismo criterio que acepta `validateRecurrence`).
 */
export function bySetPosIn(instant: Date, timeZone: string): BySetPos {
  const { year, month, day } = wallClock(instant, timeZone);
  const civilDay = civilToDays(year, month, day);
  return isLastWeekdayOfMonth(civilDay) ? -1 : (ordinalOfWeekdayInMonth(civilDay) as BySetPos);
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
  if (rule.bySetPos !== undefined) out.bySetPos = rule.bySetPos;
  if (rule.until !== undefined) out.until = rule.until;
  if (rule.count !== undefined) out.count = rule.count;
  return out;
}

/**
 * Clave para comparar reglas por contenido. No depende del orden de las claves: PostgreSQL
 * devuelve los `jsonb` con las claves reordenadas (por longitud), así que comparar con
 * `JSON.stringify` daría «distinto» para dos reglas iguales.
 */
export function recurrenceKey(rule: RecurrenceRule | null): string {
  if (rule === null) return '';
  return JSON.stringify([
    rule.freq,
    rule.interval,
    rule.byWeekday ?? null,
    rule.bySetPos ?? null,
    rule.until ?? null,
    rule.count ?? null,
  ]);
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

  if (rule.bySetPos !== undefined) {
    if (rule.freq !== 'monthly' && rule.freq !== 'yearly') {
      issues.push(at('bySetPos solo se admite con freq monthly o yearly'));
    } else if (!(BY_SET_POS_VALUES as readonly number[]).includes(rule.bySetPos)) {
      issues.push(at('bySetPos debe ser 1, 2, 3, 4 o -1 (última)'));
    } else if (startDay !== null) {
      const ordinal = ordinalOfWeekdayInMonth(startDay);
      const isLast = isLastWeekdayOfMonth(startDay);
      if (rule.bySetPos !== ordinal && !(rule.bySetPos === -1 && isLast)) {
        issues.push(
          at('bySetPos no coincide con qué ocurrencia de ese día de la semana es el inicio'),
        );
      }
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
  } else if (rule.freq === 'monthly') {
    const startIndex = start.year * 12 + (start.month - 1);
    const from = daysToCivil(fromDay);
    const fromIndex = from.year * 12 + (from.month - 1);
    const k0 = firstPeriod((fromIndex - startIndex) / interval);
    for (let k = k0; ; k++) {
      const index = startIndex + k * interval;
      const year = Math.floor(index / 12);
      const month = mod(index, 12) + 1;
      const day =
        rule.bySetPos === undefined
          ? start.day <= daysInMonth(year, month)
            ? civilToDays(year, month, start.day)
            : null
          : nthWeekdayOfMonth(year, month, weekdayOf(startDay), rule.bySetPos);
      if (day !== null) yield day;
    }
  } else {
    // yearly
    const from = daysToCivil(fromDay);
    const k0 = firstPeriod((from.year - start.year) / interval);
    for (let k = k0; ; k++) {
      const year = start.year + k * interval;
      const day =
        rule.bySetPos === undefined
          ? start.month === 2 && start.day === 29 && !isLeapYear(year)
            ? null
            : civilToDays(year, start.month, start.day)
          : nthWeekdayOfMonth(year, start.month, weekdayOf(startDay), rule.bySetPos);
      if (day !== null) yield day;
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

export interface RecurrenceSplit {
  /**
   * Regla de la serie original, truncada justo antes de `at`; `null` si no queda ninguna
   * ocurrencia antes (`at` era la primera), y por tanto la serie original no tiene sentido.
   */
  before: RecurrenceRule | null;
  /** Regla de la serie nueva que sigue desde `at`: misma cadencia, `count` recalculado. */
  after: RecurrenceRule;
}

/**
 * Parte una serie en dos por la ocurrencia `at` («esta y las siguientes»). No comprueba que
 * `at` sea una ocurrencia real de `series`: eso es responsabilidad de quien llama.
 */
export function splitRecurrenceAt(series: RecurringSeries, at: Date): RecurrenceSplit {
  const rule = series.recurrence;
  const consumed = expandOccurrences(
    series,
    { from: series.startAt, to: at },
    MAX_OCCURRENCES_PER_EXPANSION,
  ).length;

  const atWall = wallClock(at, series.timezone);
  const atDay = civilToDays(atWall.year, atWall.month, atWall.day);
  const cadence = {
    freq: rule.freq,
    interval: rule.interval,
    ...(rule.byWeekday && { byWeekday: rule.byWeekday }),
    ...(rule.bySetPos !== undefined && { bySetPos: rule.bySetPos }),
  };

  const before: RecurrenceRule | null =
    consumed === 0 ? null : { ...cadence, until: formatCivilDate(atDay - 1) };

  const after: RecurrenceRule =
    rule.count === undefined ? { ...rule } : { ...cadence, count: rule.count - consumed };

  return { before, after };
}
