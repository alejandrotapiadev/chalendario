import { describe, expect, it } from 'vitest';
import {
  availableTimezones,
  fromWallFields,
  isTimezone,
  localEquivalent,
  toWallFields,
} from './zoned.ts';

const iso = (d: Date | undefined) => d?.toISOString();

describe('toWallFields / fromWallFields', () => {
  it('muestra un instante como hora de pared en la zona del evento, no en la del navegador', () => {
    const start = new Date('2026-09-21T09:00:00Z');
    const end = new Date('2026-09-21T10:30:00Z');
    expect(toWallFields(start, end, false, 'Europe/Madrid')).toEqual({
      startDate: '2026-09-21',
      startTime: '11:00',
      endDate: '2026-09-21',
      endTime: '12:30',
    });
    expect(toWallFields(start, end, false, 'Europe/London')).toMatchObject({
      startTime: '10:00',
      endTime: '11:30',
    });
    expect(toWallFields(start, end, false, 'America/New_York')).toMatchObject({
      startTime: '05:00',
    });
    expect(toWallFields(start, end, false, 'Asia/Tokyo')).toMatchObject({ startTime: '18:00' });
  });

  it('la fecha puede cambiar según la zona (cruza medianoche)', () => {
    const start = new Date('2026-09-21T23:30:00Z'); // ya es día 22 en Tokio
    const end = new Date('2026-09-22T00:30:00Z');
    expect(toWallFields(start, end, false, 'UTC').startDate).toBe('2026-09-21');
    expect(toWallFields(start, end, false, 'Asia/Tokyo').startDate).toBe('2026-09-22');
  });

  it('interpreta las horas del formulario en la zona elegida', () => {
    const fields = {
      startDate: '2026-09-21',
      startTime: '10:00',
      endDate: '2026-09-21',
      endTime: '11:00',
    };
    expect(iso(fromWallFields(fields, false, 'Europe/London')?.start)).toBe(
      '2026-09-21T09:00:00.000Z',
    );
    expect(iso(fromWallFields(fields, false, 'Europe/Madrid')?.start)).toBe(
      '2026-09-21T08:00:00.000Z',
    );
    expect(iso(fromWallFields(fields, false, 'America/New_York')?.start)).toBe(
      '2026-09-21T14:00:00.000Z',
    );
    expect(iso(fromWallFields(fields, false, 'UTC')?.end)).toBe('2026-09-21T11:00:00.000Z');
  });

  it('la misma hora de pared cambia de instante UTC con el horario de verano', () => {
    const summer = {
      startDate: '2026-07-01',
      startTime: '10:00',
      endDate: '2026-07-01',
      endTime: '11:00',
    };
    const winter = {
      startDate: '2026-12-01',
      startTime: '10:00',
      endDate: '2026-12-01',
      endTime: '11:00',
    };
    expect(iso(fromWallFields(summer, false, 'Europe/Madrid')?.start)).toBe(
      '2026-07-01T08:00:00.000Z',
    );
    expect(iso(fromWallFields(winter, false, 'Europe/Madrid')?.start)).toBe(
      '2026-12-01T09:00:00.000Z',
    );
  });

  it('ida y vuelta: toWallFields → fromWallFields devuelve los mismos instantes', () => {
    const start = new Date('2026-10-25T00:30:00Z');
    const end = new Date('2026-10-25T02:15:00Z');
    for (const zone of [
      'Europe/Madrid',
      'America/New_York',
      'Asia/Kolkata',
      'Pacific/Auckland',
      'UTC',
    ]) {
      const back = fromWallFields(toWallFields(start, end, false, zone), false, zone);
      expect(iso(back?.start), zone).toBe(start.toISOString());
      expect(iso(back?.end), zone).toBe(end.toISOString());
    }
  });

  describe('todo el día', () => {
    it('el fin exclusivo se muestra como último día y vuelve a ser medianoche del día siguiente', () => {
      // Vie 25 – dom 27 sep en Madrid: fin exclusivo = lun 28 00:00 local.
      const start = new Date('2026-09-24T22:00:00Z');
      const end = new Date('2026-09-27T22:00:00Z');
      const fields = toWallFields(start, end, true, 'Europe/Madrid');
      expect(fields).toMatchObject({ startDate: '2026-09-25', endDate: '2026-09-27' });
      const back = fromWallFields(fields, true, 'Europe/Madrid');
      expect(iso(back?.start)).toBe(start.toISOString());
      expect(iso(back?.end)).toBe(end.toISOString());
    });

    it('funciona en zonas al este y al oeste de UTC y con cambio de mes', () => {
      for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Sao_Paulo']) {
        const start = fromWallFields(
          { startDate: '2026-09-30', startTime: '', endDate: '2026-10-01', endTime: '' },
          true,
          zone,
        )!;
        const fields = toWallFields(start.start, start.end, true, zone);
        expect(fields).toMatchObject({ startDate: '2026-09-30', endDate: '2026-10-01' });
      }
    });
  });

  it('devuelve null con fechas u horas inválidas', () => {
    const ok = {
      startDate: '2026-09-21',
      startTime: '10:00',
      endDate: '2026-09-21',
      endTime: '11:00',
    };
    expect(fromWallFields({ ...ok, startDate: '' }, false, 'UTC')).toBeNull();
    expect(fromWallFields({ ...ok, endTime: '' }, false, 'UTC')).toBeNull();
    expect(fromWallFields({ ...ok, startDate: 'ayer' }, false, 'UTC')).toBeNull();
    // Las horas no importan en un evento de todo el día.
    expect(fromWallFields({ ...ok, startTime: '', endTime: '' }, true, 'UTC')).not.toBeNull();
  });
});

describe('localEquivalent', () => {
  it('no dice nada si la zona del evento es la del navegador o no es válida', () => {
    const start = new Date('2026-09-21T09:00:00Z');
    expect(localEquivalent(start, 'Europe/Madrid', 'Europe/Madrid')).toBeNull();
    expect(localEquivalent(start, 'Marte/Olimpo', 'Europe/Madrid')).toBeNull();
    expect(localEquivalent(null, 'Europe/London', 'Europe/Madrid')).toBeNull();
  });

  it('indica la hora equivalente en la zona del navegador', () => {
    // 10:00 en Londres = 11:00 en Madrid
    const start = new Date('2026-09-21T09:00:00Z');
    expect(localEquivalent(start, 'Europe/London', 'Europe/Madrid')).toMatch(
      /^Equivale a .*11:00 en tu zona \(Europe\/Madrid\)$/,
    );
  });
});

describe('zonas disponibles', () => {
  it('incluye UTC y zonas habituales, sin repetidos, y valida nombres', () => {
    const zones = availableTimezones();
    expect(zones).toContain('UTC');
    expect(zones).toContain('Europe/Madrid');
    expect(new Set(zones).size).toBe(zones.length);
    expect(isTimezone('Europe/Madrid')).toBe(true);
    expect(isTimezone('Europe/Nowhere')).toBe(false);
  });
});
