import { describe, expect, it } from 'vitest';
import { newEventFields } from './event.ts';
import { describeChanges, type EventSnapshot } from './history.ts';

const v1: EventSnapshot = {
  ...newEventFields({
    title: 'Gym',
    startAt: new Date('2026-09-21T08:00:00Z'),
    endAt: new Date('2026-09-21T09:00:00Z'),
    timezone: 'Europe/Madrid',
  }),
  deleted: false,
};

describe('describeChanges', () => {
  it('la versión 1 no describe cambios (es la creación)', () => {
    expect(describeChanges(null, v1)).toEqual([]);
  });

  it('sin diferencias devuelve una lista vacía, aunque las fechas sean objetos distintos', () => {
    const copy = { ...v1, startAt: new Date(v1.startAt), endAt: new Date(v1.endAt) };
    expect(describeChanges(v1, copy)).toEqual([]);
  });

  it('describe un cambio de hora con los valores anterior y nuevo en ISO UTC', () => {
    const v2 = {
      ...v1,
      startAt: new Date('2026-09-21T09:00:00Z'),
      endAt: new Date('2026-09-21T10:00:00Z'),
    };
    expect(describeChanges(v1, v2)).toEqual([
      { field: 'startAt', from: '2026-09-21T08:00:00.000Z', to: '2026-09-21T09:00:00.000Z' },
      { field: 'endAt', from: '2026-09-21T09:00:00.000Z', to: '2026-09-21T10:00:00.000Z' },
    ]);
  });

  it('describe varios campos, el color nulo y el borrado', () => {
    const v2: EventSnapshot = {
      ...v1,
      location: 'Sala 2',
      color: '#112233',
      status: 'cancelled',
      deleted: true,
    };
    expect(describeChanges(v1, v2)).toEqual([
      { field: 'location', from: '', to: 'Sala 2' },
      { field: 'status', from: 'confirmed', to: 'cancelled' },
      { field: 'color', from: null, to: '#112233' },
      { field: 'deleted', from: false, to: true },
    ]);
  });
});
