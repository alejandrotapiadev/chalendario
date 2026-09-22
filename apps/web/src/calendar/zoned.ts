import { isValidTimezone, wallClock, zonedTimeToInstant } from '@calendar/domain';
import { LOCALE } from './dates.ts';

/** Fecha y hora de pared, tal como las muestran los `<input type="date">` y `type="time"`. */
export interface WallFields {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

interface Civil {
  year: number;
  month: number;
  day: number;
}

const civilText = ({ year, month, day }: Civil) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

function addCivilDays({ year, month, day }: Civil, days: number): Civil {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parseDate(text: string): Civil | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

function parseTime(text: string): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/**
 * Instantes de un evento como fecha y hora **en la zona `timeZone`**. En los eventos de todo el
 * día el fin es exclusivo (medianoche del día siguiente) y el formulario muestra el último día.
 */
export function toWallFields(
  startAt: Date,
  endAt: Date,
  allDay: boolean,
  timeZone: string,
): WallFields {
  const start = wallClock(startAt, timeZone);
  const end = wallClock(endAt, timeZone);
  return {
    startDate: civilText(start),
    startTime: `${pad(start.hour)}:${pad(start.minute)}`,
    endDate: civilText(allDay ? addCivilDays(end, -1) : end),
    endTime: `${pad(end.hour)}:${pad(end.minute)}`,
  };
}

/**
 * Inverso de `toWallFields`: interpreta las horas del formulario en la zona del evento. Devuelve
 * null si alguna fecha u hora no es válida.
 */
export function fromWallFields(
  fields: WallFields,
  allDay: boolean,
  timeZone: string,
): { start: Date; end: Date } | null {
  const startDate = parseDate(fields.startDate);
  const endDate = parseDate(fields.endDate);
  if (!startDate || !endDate) return null;

  if (allDay) {
    const exclusiveEnd = addCivilDays(endDate, 1);
    return {
      start: zonedTimeToInstant(startDate.year, startDate.month, startDate.day, 0, 0, 0, timeZone),
      end: zonedTimeToInstant(
        exclusiveEnd.year,
        exclusiveEnd.month,
        exclusiveEnd.day,
        0,
        0,
        0,
        timeZone,
      ),
    };
  }
  const startTime = parseTime(fields.startTime);
  const endTime = parseTime(fields.endTime);
  if (!startTime || !endTime) return null;
  return {
    start: zonedTimeToInstant(
      startDate.year,
      startDate.month,
      startDate.day,
      startTime.hour,
      startTime.minute,
      0,
      timeZone,
    ),
    end: zonedTimeToInstant(
      endDate.year,
      endDate.month,
      endDate.day,
      endTime.hour,
      endTime.minute,
      0,
      timeZone,
    ),
  };
}

/** Zonas IANA que ofrece el navegador, más `UTC`. */
export function availableTimezones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return supported.includes('UTC') ? supported : ['UTC', ...supported];
}

export const isTimezone = isValidTimezone;

const localFormat = (timeZone: string) =>
  new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });

/**
 * Nota «equivale a…» para cuando la zona del evento no es `referenceZone` (la de
 * visualización elegida, T-10); null si son la misma o el intervalo no es válido.
 */
export function localEquivalent(
  start: Date | null,
  eventZone: string,
  referenceZone: string,
): string | null {
  if (!start || eventZone === referenceZone || !isValidTimezone(eventZone)) return null;
  return `Equivale a ${localFormat(referenceZone).format(start)} en tu zona (${referenceZone})`;
}
