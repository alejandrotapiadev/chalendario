import type { ReminderDto } from '@calendar/shared';
import { describe, expect, it } from 'vitest';
import {
  describeReminder,
  fresh,
  pending,
  pruneDismissed,
  reminderKey,
  whenLabel,
} from './reminders.ts';

const reminder = (over: Partial<ReminderDto> = {}): ReminderDto => ({
  eventId: 'e1',
  title: 'Reunión',
  location: '',
  allDay: false,
  occurrenceStartAt: '2026-09-21T08:00:00.000Z',
  occurrenceEndAt: '2026-09-21T09:00:00.000Z',
  minutesBefore: 10,
  triggerAt: '2026-09-21T07:50:00.000Z',
  ...over,
});

describe('describeReminder', () => {
  it.each([
    [0, 'A la hora del evento'],
    [1, '1 minuto antes'],
    [10, '10 minutos antes'],
    [45, '45 minutos antes'],
    [60, '1 hora antes'],
    [120, '2 horas antes'],
    [90, '90 minutos antes'],
    [1440, '1 día antes'],
    [2880, '2 días antes'],
    [10080, '1 semana antes'],
    [20160, '2 semanas antes'],
  ])('%i min → %s', (minutes, text) => {
    expect(describeReminder(minutes)).toBe(text);
  });
});

describe('whenLabel', () => {
  const at = (iso: string) => new Date(iso);
  it('describe cuánto falta o cuánto lleva empezado', () => {
    const start = '2026-09-21T08:00:00.000Z';
    expect(whenLabel(start, at('2026-09-21T07:50:00Z'))).toBe('empieza en 10 min');
    expect(whenLabel(start, at('2026-09-21T06:00:00Z'))).toBe('empieza en 2 h');
    expect(whenLabel(start, at('2026-09-19T08:00:00Z'))).toBe('empieza en 2 d');
    expect(whenLabel(start, at('2026-09-21T08:00:00Z'))).toBe('empieza ahora');
    expect(whenLabel(start, at('2026-09-21T08:05:00Z'))).toBe('empezó hace 5 min');
    expect(whenLabel(start, at('2026-09-21T10:00:00Z'))).toBe('en curso desde hace 2 h');
  });
});

describe('gestión de avisos', () => {
  const a = reminder();
  const b = reminder({ minutesBefore: 30, triggerAt: '2026-09-21T07:30:00.000Z' });
  const c = reminder({ eventId: 'e2' });

  it('la clave distingue evento, ocurrencia y antelación', () => {
    expect(
      new Set(
        [a, b, c, reminder({ occurrenceStartAt: '2026-09-22T08:00:00.000Z' })].map(reminderKey),
      ).size,
    ).toBe(4);
  });

  it('pending oculta los descartados y conserva el orden', () => {
    expect(pending([a, b, c], new Set([reminderKey(b)]))).toEqual([a, c]);
    expect(pending([a], new Set())).toEqual([a]);
  });

  it('fresh devuelve solo los que no se conocían', () => {
    expect(fresh([a, b, c], new Set([reminderKey(a)]))).toEqual([b, c]);
  });

  it('pruneDismissed olvida los avisos que ya no están activos', () => {
    const dismissed = new Set([reminderKey(a), reminderKey(b), 'viejo|x|1']);
    expect(pruneDismissed(dismissed, [a, c])).toEqual(new Set([reminderKey(a)]));
    expect(pruneDismissed(dismissed, [])).toEqual(new Set());
  });
});
