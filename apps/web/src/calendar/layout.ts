import type { EventDto } from '@calendar/shared';
import { addDays, startOfDay } from './dates.ts';

/** Parte de un evento que cae dentro de un día concreto. */
export interface DaySegment {
  event: EventDto;
  /** Minutos desde las 00:00 local del día (0–1440). */
  startMinute: number;
  endMinute: number;
}

export interface PositionedSegment extends DaySegment {
  /** Columna asignada dentro de su grupo de eventos solapados. */
  column: number;
  /** Nº de columnas del grupo: el ancho de cada evento es 1/columns. */
  columns: number;
}

export function overlapsDay(event: EventDto, day: Date): boolean {
  const start = startOfDay(day);
  const end = addDays(start, 1);
  return new Date(event.startAt) < end && new Date(event.endAt) > start;
}

/** Eventos de un día, separados en «todo el día» y con hora (recortados a ese día). */
export function eventsForDay(
  events: EventDto[],
  day: Date,
): { allDay: EventDto[]; timed: DaySegment[] } {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const minutesInDay = (instant: Date) =>
    instant <= dayStart
      ? 0
      : instant >= dayEnd
        ? 1440
        : instant.getHours() * 60 + instant.getMinutes();

  const allDay: EventDto[] = [];
  const timed: DaySegment[] = [];
  for (const event of events) {
    if (!overlapsDay(event, day)) continue;
    if (event.allDay) {
      allDay.push(event);
    } else {
      timed.push({
        event,
        startMinute: minutesInDay(new Date(event.startAt)),
        endMinute: minutesInDay(new Date(event.endAt)),
      });
    }
  }
  return { allDay, timed };
}

/**
 * Reparte en columnas los eventos que se solapan para que no se pisen. Cada grupo de
 * eventos encadenados por solape comparte un número de columnas.
 */
export function layoutSegments(segments: DaySegment[]): PositionedSegment[] {
  const sorted = [...segments].sort(
    (a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute,
  );
  const result: PositionedSegment[] = [];

  let group: PositionedSegment[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -1;

  const closeGroup = () => {
    for (const s of group) s.columns = columnEnds.length;
    result.push(...group);
    group = [];
    columnEnds = [];
  };

  for (const segment of sorted) {
    if (group.length > 0 && segment.startMinute >= groupEnd) closeGroup();

    let column = columnEnds.findIndex((end) => end <= segment.startMinute);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = segment.endMinute;
    groupEnd = Math.max(groupEnd, segment.endMinute);
    if (group.length === 0) groupEnd = segment.endMinute;
    group.push({ ...segment, column, columns: 1 });
  }
  closeGroup();
  return result;
}
