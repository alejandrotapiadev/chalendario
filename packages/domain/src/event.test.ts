import { describe, expect, it } from 'vitest';
import {
  InvalidEventError,
  applyEventPatch,
  hasChanges,
  newEventFields,
  validateEventFields,
  type EventFields,
} from './event.ts';
import { isLocalMidnight, isValidTimezone } from './timezone.ts';

const gym = () =>
  newEventFields({
    title: 'Gym',
    startAt: new Date('2026-09-21T08:00:00Z'),
    endAt: new Date('2026-09-21T09:00:00Z'),
    timezone: 'Europe/Madrid',
  });

describe('newEventFields', () => {
  it('aplica valores por defecto', () => {
    expect(gym()).toMatchObject({
      description: '',
      location: '',
      allDay: false,
      status: 'confirmed',
      color: null,
    });
  });

  it('recorta el título', () => {
    const e = newEventFields({ ...gym(), title: '  Dentista  ' });
    expect(e.title).toBe('Dentista');
  });

  it('rechaza título vacío, fin anterior al inicio y zona horaria desconocida', () => {
    const attempt = () =>
      newEventFields({
        title: '   ',
        startAt: new Date('2026-09-21T10:00:00Z'),
        endAt: new Date('2026-09-21T09:00:00Z'),
        timezone: 'Mars/Olympus',
      });
    expect(attempt).toThrow(InvalidEventError);
    try {
      attempt();
    } catch (err) {
      expect((err as InvalidEventError).issues).toEqual([
        expect.stringContaining('title'),
        expect.stringContaining('timezone'),
        expect.stringContaining('endAt'),
      ]);
    }
  });

  it('rechaza fin igual al inicio y fechas inválidas', () => {
    const t = new Date('2026-09-21T10:00:00Z');
    expect(() => newEventFields({ ...gym(), startAt: t, endAt: t })).toThrow(/endAt/);
    expect(() => newEventFields({ ...gym(), startAt: new Date('nope') })).toThrow(/startAt/);
  });

  it('valida el formato del color', () => {
    expect(newEventFields({ ...gym(), color: '#FFaa00' }).color).toBe('#FFaa00');
    expect(() => newEventFields({ ...gym(), color: 'red' })).toThrow(/color/);
  });
});

describe('eventos de todo el día', () => {
  // 21 sep 2026 en Madrid es CEST (UTC+2): la medianoche local es 22:00Z del día anterior.
  const allDay = {
    title: 'Vacaciones',
    allDay: true,
    timezone: 'Europe/Madrid',
    startAt: new Date('2026-09-20T22:00:00Z'),
    endAt: new Date('2026-09-21T22:00:00Z'),
  };

  it('acepta medianoche local a medianoche local', () => {
    expect(newEventFields(allDay).allDay).toBe(true);
  });

  it('rechaza límites que no son medianoche local', () => {
    expect(() => newEventFields({ ...allDay, startAt: new Date('2026-09-21T00:00:00Z') })).toThrow(
      /medianoche/,
    );
    expect(() => newEventFields({ ...allDay, endAt: new Date('2026-09-21T23:00:00Z') })).toThrow(
      /medianoche/,
    );
  });

  it('respeta el cambio de hora: en invierno la medianoche es 23:00Z', () => {
    const winter = {
      ...allDay,
      startAt: new Date('2026-12-14T23:00:00Z'),
      endAt: new Date('2026-12-15T23:00:00Z'),
    };
    expect(newEventFields(winter).allDay).toBe(true);
  });
});

describe('applyEventPatch', () => {
  it('cambia solo los campos indicados', () => {
    const next = applyEventPatch(gym(), { startAt: new Date('2026-09-21T08:30:00Z') });
    expect(next.title).toBe('Gym');
    expect(next.startAt.toISOString()).toBe('2026-09-21T08:30:00.000Z');
  });

  it('ignora campos undefined y permite quitar el color con null', () => {
    const colored = applyEventPatch(gym(), { color: '#112233' });
    const next = applyEventPatch(colored, { title: undefined, color: null });
    expect(next.title).toBe('Gym');
    expect(next.color).toBeNull();
  });

  it('valida el resultado completo, no solo el parche', () => {
    // El parche por sí solo es válido, pero deja el inicio después del fin.
    expect(() => applyEventPatch(gym(), { startAt: new Date('2026-09-21T12:00:00Z') })).toThrow(
      /endAt/,
    );
  });

  it('activar allDay exige alinear las fechas', () => {
    expect(() => applyEventPatch(gym(), { allDay: true })).toThrow(/medianoche/);
  });

  it('no muta el original', () => {
    const original = gym();
    applyEventPatch(original, { title: 'Otro' });
    expect(original.title).toBe('Gym');
  });
});

describe('hasChanges', () => {
  it('detecta igualdad y diferencias, comparando fechas por valor', () => {
    const a = gym();
    const copy: EventFields = { ...a, startAt: new Date(a.startAt), endAt: new Date(a.endAt) };
    expect(hasChanges(a, copy)).toBe(false);
    expect(hasChanges(a, { ...copy, location: 'Sala 2' })).toBe(true);
    expect(hasChanges(a, { ...copy, endAt: new Date('2026-09-21T09:30:00Z') })).toBe(true);
  });
});

describe('validateEventFields', () => {
  it('devuelve lista vacía para un evento válido', () => {
    expect(validateEventFields(gym())).toEqual([]);
  });
});

describe('timezone', () => {
  it('valida zonas IANA', () => {
    expect(isValidTimezone('Europe/Madrid')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/Nowhere')).toBe(false);
  });

  it('detecta la medianoche local', () => {
    expect(isLocalMidnight(new Date('2026-09-20T22:00:00Z'), 'Europe/Madrid')).toBe(true);
    expect(isLocalMidnight(new Date('2026-09-20T22:00:00Z'), 'UTC')).toBe(false);
    expect(isLocalMidnight(new Date('2026-09-20T22:00:00.500Z'), 'Europe/Madrid')).toBe(false);
  });
});
