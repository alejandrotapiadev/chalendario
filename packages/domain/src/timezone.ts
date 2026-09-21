// Crear un Intl.DateTimeFormat es caro (~100 µs) y expandir una recurrencia lo necesita
// miles de veces: se reutiliza uno por zona horaria.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Hora de pared de un instante en una zona horaria. */
export function wallClock(instant: Date, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function isLocalMidnight(instant: Date, timeZone: string): boolean {
  if (instant.getUTCMilliseconds() !== 0) return false;
  const { hour, minute, second } = wallClock(instant, timeZone);
  return hour === 0 && minute === 0 && second === 0;
}

/** Desfase (ms) de la hora de pared respecto a UTC en un instante. */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallClock(new Date(ms), timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - ms;
}

const DAY_MS = 86_400_000;

/**
 * Instante que corresponde a una hora de pared en una zona horaria (lo inverso de
 * `wallClock`). `month` es 1–12.
 *
 * Si esa hora existe dos veces (fin del horario de verano) devuelve la primera; si no existe
 * (salto de primavera) la desplaza hacia delante, como hacen los calendarios habituales.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  // Los desfases un día antes y un día después cubren los dos lados de un cambio de hora.
  const before = offsetAt(target - DAY_MS, timeZone);
  const after = offsetAt(target + DAY_MS, timeZone);
  const valid = [target - before, target - after].filter(
    (t) => offsetAt(t, timeZone) === target - t,
  );
  return new Date(valid.length > 0 ? Math.min(...valid) : target - before);
}
