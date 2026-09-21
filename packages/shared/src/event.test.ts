import { describe, expect, it } from 'vitest';
import { createEventSchema, listEventsQuerySchema, updateEventSchema } from './event.ts';

const valid = {
  calendarId: '3f1c2a54-6a5e-4c4b-9f0e-0a4c8f0f6b11',
  title: 'Gym',
  startAt: '2026-09-21T10:00:00Z',
  endAt: '2026-09-21T11:00:00+02:00',
  timezone: 'Europe/Madrid',
};

describe('createEventSchema', () => {
  it('acepta el mínimo y fechas con offset', () => {
    expect(createEventSchema.safeParse(valid).success).toBe(true);
  });

  it('rechaza fechas sin zona, calendarId no uuid y campos desconocidos', () => {
    expect(createEventSchema.safeParse({ ...valid, startAt: '2026-09-21T10:00:00' }).success).toBe(
      false,
    );
    expect(createEventSchema.safeParse({ ...valid, calendarId: 'x' }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...valid, foo: 1 }).success).toBe(false);
  });
});

describe('updateEventSchema', () => {
  it('permite parches parciales, color null y expectedVersion', () => {
    expect(updateEventSchema.safeParse({}).success).toBe(true);
    expect(updateEventSchema.safeParse({ color: null, expectedVersion: 3 }).success).toBe(true);
  });

  it('no permite cambiar el calendario', () => {
    expect(updateEventSchema.safeParse({ calendarId: valid.calendarId }).success).toBe(false);
  });
});

describe('listEventsQuerySchema', () => {
  it('exige to > from y limita el rango', () => {
    const ok = { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' };
    expect(listEventsQuerySchema.safeParse(ok).success).toBe(true);
    expect(listEventsQuerySchema.safeParse({ from: ok.to, to: ok.from }).success).toBe(false);
    expect(
      listEventsQuerySchema.safeParse({ from: ok.from, to: '2028-01-01T00:00:00Z' }).success,
    ).toBe(false);
  });
});
