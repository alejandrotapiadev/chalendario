import type { EventDto } from '@calendar/shared';
import { describe, expect, it } from 'vitest';
import { eventsForDay, layoutSegments, type DaySegment } from './layout.ts';

const event = (over: Partial<EventDto> & { start: Date; end: Date }): EventDto => ({
  id: over.id ?? 'e',
  calendarId: 'c',
  seriesId: null,
  recurrenceId: null,
  version: 1,
  title: over.title ?? 'Evento',
  description: '',
  startAt: over.start.toISOString(),
  endAt: over.end.toISOString(),
  timezone: 'UTC',
  allDay: over.allDay ?? false,
  location: '',
  status: 'confirmed',
  color: null,
  recurrence: null,
  categoryId: null,
  reminders: [],
  createdAt: '',
  updatedAt: '',
});

describe('eventsForDay', () => {
  // Instantes reales en UTC; se lee con timeZone: 'UTC' para no depender de la zona de
  // quien ejecuta el test.
  const day = new Date(2026, 8, 21); // lunes 21 sep
  const utc = (...args: Parameters<typeof Date.UTC>) => new Date(Date.UTC(...args));

  it('separa los eventos de todo el día y recorta los que cruzan medianoche', () => {
    const events = [
      event({ id: 'a', start: utc(2026, 8, 21, 9), end: utc(2026, 8, 21, 10, 30) }),
      event({ id: 'b', start: utc(2026, 8, 20, 22), end: utc(2026, 8, 21, 2) }),
      event({ id: 'c', start: utc(2026, 8, 21, 23), end: utc(2026, 8, 22, 1) }),
      event({ id: 'd', allDay: true, start: utc(2026, 8, 20), end: utc(2026, 8, 22) }),
      event({ id: 'x', start: utc(2026, 8, 22, 9), end: utc(2026, 8, 22, 10) }),
    ];
    const { allDay, timed } = eventsForDay(events, day, 'UTC');
    expect(allDay.map((e) => e.id)).toEqual(['d']);
    expect(timed.map((s) => [s.event.id, s.startMinute, s.endMinute])).toEqual([
      ['a', 540, 630],
      ['b', 0, 120],
      ['c', 1380, 1440],
    ]);
  });

  it('un evento que termina justo a medianoche no cuenta para el día siguiente', () => {
    const e = event({ start: utc(2026, 8, 20, 23), end: utc(2026, 8, 21, 0) });
    expect(eventsForDay([e], day, 'UTC').timed).toEqual([]);
  });
});

describe('layoutSegments', () => {
  const seg = (id: string, startMinute: number, endMinute: number): DaySegment => ({
    event: event({ id, start: new Date(), end: new Date() }),
    startMinute,
    endMinute,
  });
  const place = (segments: DaySegment[]) =>
    Object.fromEntries(layoutSegments(segments).map((s) => [s.event.id, [s.column, s.columns]]));

  it('un evento solo ocupa todo el ancho', () => {
    expect(place([seg('a', 60, 120)])).toEqual({ a: [0, 1] });
  });

  it('eventos consecutivos (sin solape) no comparten columnas', () => {
    expect(place([seg('a', 60, 120), seg('b', 120, 180)])).toEqual({ a: [0, 1], b: [0, 1] });
  });

  it('eventos solapados se reparten en columnas', () => {
    expect(place([seg('a', 60, 180), seg('b', 90, 150)])).toEqual({ a: [0, 2], b: [1, 2] });
  });

  it('reutiliza columnas libres dentro del mismo grupo', () => {
    // a solapa con b y con c, pero b y c no se solapan entre sí: caben en 2 columnas.
    expect(place([seg('a', 60, 240), seg('b', 60, 120), seg('c', 150, 200)])).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [1, 2],
    });
  });

  it('grupos independientes tienen su propio número de columnas', () => {
    const p = place([seg('a', 0, 60), seg('b', 30, 90), seg('c', 300, 360)]);
    expect(p).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });

  it('no depende del orden de entrada', () => {
    const inputs = [seg('b', 90, 150), seg('a', 60, 180)];
    expect(place(inputs)).toEqual({ a: [0, 2], b: [1, 2] });
  });
});
