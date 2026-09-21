import { describe, expect, it } from 'vitest';
import { InvalidEventError, hasChanges, newEventFields } from './event.ts';
import { describeChanges } from './history.ts';
import {
  expandOccurrences,
  normalizeRecurrence,
  validateRecurrence,
  weekdayIn,
  type RecurrenceRule,
  type RecurringSeries,
} from './recurrence.ts';
import { wallClock, zonedTimeToInstant } from './timezone.ts';

const TZ = 'Europe/Madrid';

/** Instante a partir de una hora de pared en Madrid. */
const madrid = (y: number, m: number, d: number, h = 0, mi = 0) =>
  zonedTimeToInstant(y, m, d, h, mi, 0, TZ);

/** «2026-09-21 10:00» en Madrid, para leer resultados. */
function local(instant: Date, tz = TZ): string {
  const w = wallClock(instant, tz);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${w.year}-${p(w.month)}-${p(w.day)} ${p(w.hour)}:${p(w.minute)}`;
}

const series = (
  recurrence: RecurrenceRule,
  over: Partial<RecurringSeries> = {},
): RecurringSeries => ({
  startAt: madrid(2026, 9, 21, 10), // lunes
  endAt: madrid(2026, 9, 21, 11),
  timezone: TZ,
  allDay: false,
  recurrence,
  ...over,
});

const expand = (s: RecurringSeries, from: Date, to: Date, limit?: number) =>
  expandOccurrences(s, { from, to }, limit);
const starts = (s: RecurringSeries, from: Date, to: Date) =>
  expand(s, from, to).map((o) => local(o.startAt));

describe('zonedTimeToInstant', () => {
  it('es la inversa de wallClock, también en los cambios de hora', () => {
    expect(zonedTimeToInstant(2026, 9, 21, 10, 0, 0, TZ).toISOString()).toBe(
      '2026-09-21T08:00:00.000Z',
    );
    expect(zonedTimeToInstant(2026, 12, 15, 10, 0, 0, TZ).toISOString()).toBe(
      '2026-12-15T09:00:00.000Z',
    );
    // Hora ambigua (02:30 ocurre dos veces el 25 oct 2026): la primera.
    expect(zonedTimeToInstant(2026, 10, 25, 2, 30, 0, TZ).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    // Hora inexistente (02:30 el 29 mar 2026): un instante válido cercano.
    const gap = zonedTimeToInstant(2026, 3, 29, 2, 30, 0, TZ);
    expect(wallClock(gap, TZ).hour).toBeGreaterThanOrEqual(2);
    expect(wallClock(gap, TZ).hour).toBeLessThanOrEqual(3);
    expect(zonedTimeToInstant(2026, 9, 21, 10, 0, 0, 'America/New_York').toISOString()).toBe(
      '2026-09-21T14:00:00.000Z',
    );
  });
});

describe('diaria', () => {
  it('genera una ocurrencia por día a la misma hora', () => {
    const s = series({ freq: 'daily', interval: 1 });
    expect(starts(s, madrid(2026, 9, 21), madrid(2026, 9, 25))).toEqual([
      '2026-09-21 10:00',
      '2026-09-22 10:00',
      '2026-09-23 10:00',
      '2026-09-24 10:00',
    ]);
  });

  it('respeta el intervalo', () => {
    const s = series({ freq: 'daily', interval: 3 });
    expect(starts(s, madrid(2026, 9, 21), madrid(2026, 10, 3))).toEqual([
      '2026-09-21 10:00',
      '2026-09-24 10:00',
      '2026-09-27 10:00',
      '2026-09-30 10:00',
    ]);
  });

  it('conserva la hora local al cruzar el cambio de hora (los instantes UTC cambian)', () => {
    const s = series(
      { freq: 'daily', interval: 1 },
      {
        startAt: madrid(2026, 10, 23, 10),
        endAt: madrid(2026, 10, 23, 11),
      },
    );
    const result = expand(s, madrid(2026, 10, 23), madrid(2026, 10, 27));
    expect(result.map((o) => local(o.startAt))).toEqual([
      '2026-10-23 10:00',
      '2026-10-24 10:00',
      '2026-10-25 10:00',
      '2026-10-26 10:00',
    ]);
    // 23 y 24 oct: CEST (UTC+2); 25 y 26 oct: CET (UTC+1).
    expect(result.map((o) => o.startAt.getUTCHours())).toEqual([8, 8, 9, 9]);
    // La duración es la misma cada día.
    expect(result.every((o) => o.endAt.getTime() - o.startAt.getTime() === 3_600_000)).toBe(true);
  });

  it('no devuelve nada antes del inicio', () => {
    const s = series({ freq: 'daily', interval: 1 });
    expect(expand(s, madrid(2026, 9, 1), madrid(2026, 9, 21))).toEqual([]);
  });
});

describe('semanal', () => {
  it('repite en los días indicados', () => {
    const s = series({ freq: 'weekly', interval: 1, byWeekday: [0, 2] }); // lun y mié
    expect(starts(s, madrid(2026, 9, 21), madrid(2026, 10, 5))).toEqual([
      '2026-09-21 10:00',
      '2026-09-23 10:00',
      '2026-09-28 10:00',
      '2026-09-30 10:00',
    ]);
  });

  it('respeta el intervalo de semanas', () => {
    const s = series({ freq: 'weekly', interval: 2, byWeekday: [0] });
    expect(starts(s, madrid(2026, 9, 21), madrid(2026, 11, 1))).toEqual([
      '2026-09-21 10:00',
      '2026-10-05 10:00',
      '2026-10-19 10:00',
    ]);
  });

  it('no genera días de la primera semana anteriores al inicio', () => {
    // Empieza un miércoles con lun+mié: el lunes de esa semana no cuenta.
    const s = series(
      { freq: 'weekly', interval: 1, byWeekday: [0, 2] },
      { startAt: madrid(2026, 9, 23, 10), endAt: madrid(2026, 9, 23, 11) },
    );
    expect(starts(s, madrid(2026, 9, 21), madrid(2026, 10, 1))).toEqual([
      '2026-09-23 10:00',
      '2026-09-28 10:00',
      '2026-09-30 10:00',
    ]);
  });

  it('acepta los días desordenados', () => {
    const s = series({ freq: 'weekly', interval: 1, byWeekday: [4, 0] });
    expect(starts(s, madrid(2026, 9, 21), madrid(2026, 9, 29))).toEqual([
      '2026-09-21 10:00',
      '2026-09-25 10:00',
      '2026-09-28 10:00',
    ]);
  });
});

describe('mensual', () => {
  it('repite el mismo día del mes', () => {
    const s = series(
      { freq: 'monthly', interval: 1 },
      {
        startAt: madrid(2026, 9, 15, 9),
        endAt: madrid(2026, 9, 15, 10),
      },
    );
    expect(starts(s, madrid(2026, 9, 1), madrid(2027, 1, 1))).toEqual([
      '2026-09-15 09:00',
      '2026-10-15 09:00',
      '2026-11-15 09:00',
      '2026-12-15 09:00',
    ]);
  });

  it('salta los meses que no tienen ese día (31)', () => {
    const s = series(
      { freq: 'monthly', interval: 1 },
      {
        startAt: madrid(2026, 1, 31, 9),
        endAt: madrid(2026, 1, 31, 10),
      },
    );
    expect(starts(s, madrid(2026, 1, 1), madrid(2026, 7, 1))).toEqual([
      '2026-01-31 09:00',
      '2026-03-31 09:00',
      '2026-05-31 09:00',
    ]);
  });

  it('el 29 de febrero solo ocurre en años bisiestos (cada 12 meses)', () => {
    const s = series(
      { freq: 'monthly', interval: 12 },
      {
        startAt: madrid(2028, 2, 29, 9),
        endAt: madrid(2028, 2, 29, 10),
      },
    );
    expect(starts(s, madrid(2028, 1, 1), madrid(2037, 1, 1))).toEqual([
      '2028-02-29 09:00',
      '2032-02-29 09:00',
      '2036-02-29 09:00',
    ]);
  });

  it('respeta el intervalo de meses', () => {
    const s = series({ freq: 'monthly', interval: 3 });
    expect(starts(s, madrid(2026, 9, 1), madrid(2027, 6, 1))).toEqual([
      '2026-09-21 10:00',
      '2026-12-21 10:00',
      '2027-03-21 10:00',
    ]);
  });
});

describe('fin de la serie', () => {
  it('count limita el total, contando la primera ocurrencia', () => {
    const daily = series({ freq: 'daily', interval: 1, count: 3 });
    expect(starts(daily, madrid(2026, 1, 1), madrid(2030, 1, 1))).toHaveLength(3);
    // Una ventana posterior a las 3 ocurrencias no devuelve nada.
    expect(expand(daily, madrid(2026, 10, 1), madrid(2026, 11, 1))).toEqual([]);
  });

  it('count también funciona con repetición mensual y semanal', () => {
    const monthly = series({ freq: 'monthly', interval: 1, count: 2 });
    expect(starts(monthly, madrid(2026, 1, 1), madrid(2030, 1, 1))).toEqual([
      '2026-09-21 10:00',
      '2026-10-21 10:00',
    ]);
    const weekly = series({ freq: 'weekly', interval: 1, byWeekday: [0, 2], count: 3 });
    expect(starts(weekly, madrid(2026, 1, 1), madrid(2030, 1, 1))).toEqual([
      '2026-09-21 10:00',
      '2026-09-23 10:00',
      '2026-09-28 10:00',
    ]);
  });

  it('until es inclusivo', () => {
    const s = series({ freq: 'daily', interval: 1, until: '2026-09-23' });
    expect(starts(s, madrid(2026, 9, 1), madrid(2026, 12, 1))).toEqual([
      '2026-09-21 10:00',
      '2026-09-22 10:00',
      '2026-09-23 10:00',
    ]);
  });
});

describe('ventanas y duración', () => {
  it('incluye la ocurrencia que empezó antes de la ventana pero aún no ha terminado', () => {
    // 23:00–02:00 cada día. La ventana empieza el 22 a las 00:30.
    const s = series(
      { freq: 'daily', interval: 1 },
      {
        startAt: madrid(2026, 9, 21, 23),
        endAt: madrid(2026, 9, 22, 2),
      },
    );
    const result = starts(s, madrid(2026, 9, 22, 0, 30), madrid(2026, 9, 22, 12));
    expect(result).toEqual(['2026-09-21 23:00']);
  });

  it('una ocurrencia que termina justo al empezar la ventana no se incluye', () => {
    const s = series({ freq: 'daily', interval: 1 });
    expect(expand(s, madrid(2026, 9, 21, 11), madrid(2026, 9, 21, 12))).toEqual([]);
  });

  it('los eventos de todo el día conservan su número de días y la medianoche local', () => {
    // Lun 21 – mar 22 (fin exclusivo: miércoles 00:00), cada semana, cruzando el cambio de hora.
    const s = series(
      { freq: 'weekly', interval: 1, byWeekday: [0] },
      {
        allDay: true,
        startAt: madrid(2026, 10, 19),
        endAt: madrid(2026, 10, 21),
      },
    );
    const result = expand(s, madrid(2026, 10, 19), madrid(2026, 11, 10));
    expect(result.map((o) => [local(o.startAt), local(o.endAt)])).toEqual([
      ['2026-10-19 00:00', '2026-10-21 00:00'],
      ['2026-10-26 00:00', '2026-10-28 00:00'],
      ['2026-11-02 00:00', '2026-11-04 00:00'],
      ['2026-11-09 00:00', '2026-11-11 00:00'],
    ]);
  });

  it('respeta el límite de ocurrencias', () => {
    const s = series({ freq: 'daily', interval: 1 });
    expect(expand(s, madrid(2026, 1, 1), madrid(2030, 1, 1), 5)).toHaveLength(5);
    expect(expand(s, madrid(2026, 1, 1), madrid(2090, 1, 1))).toHaveLength(1000);
  });

  it('usa la zona horaria del evento, no la del servidor', () => {
    const s = series(
      { freq: 'daily', interval: 1 },
      {
        timezone: 'America/New_York',
        startAt: zonedTimeToInstant(2026, 11, 1, 9, 0, 0, 'America/New_York'),
        endAt: zonedTimeToInstant(2026, 11, 1, 10, 0, 0, 'America/New_York'),
      },
    );
    // El 1 nov 2026 acaba el horario de verano en EE. UU.: 9:00 sigue siendo 9:00.
    const result = expand(s, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-04T00:00:00Z'));
    expect(result.map((o) => local(o.startAt, 'America/New_York'))).toEqual([
      '2026-11-01 09:00',
      '2026-11-02 09:00',
      '2026-11-03 09:00',
    ]);
  });
});

describe('saltar hasta la ventana da el mismo resultado que enumerar desde el inicio', () => {
  const rules: [string, RecurrenceRule][] = [
    ['diaria cada 3', { freq: 'daily', interval: 3 }],
    ['diaria hasta', { freq: 'daily', interval: 1, until: '2027-06-30' }],
    ['semanal lun/jue cada 2', { freq: 'weekly', interval: 2, byWeekday: [0, 3] }],
    ['semanal mar-vie', { freq: 'weekly', interval: 1, byWeekday: [0, 1, 4] }],
    ['mensual cada 5', { freq: 'monthly', interval: 5 }],
  ];

  it.each(rules)('%s', (_name, rule) => {
    // Lunes 31 mar 2025; para la mensual, el día 15 (los meses de 30 días no tienen día 31,
    // y la ventana podría quedar vacía).
    const day = rule.freq === 'monthly' ? 15 : 31;
    const s = series(rule, { startAt: madrid(2025, 3, day, 8), endAt: madrid(2025, 3, day, 9) });
    const window = { from: madrid(2027, 2, 1), to: madrid(2027, 5, 1) };
    const jumped = expandOccurrences(s, window);
    // Referencia: enumerar desde el principio (ventana desde el inicio) y filtrar.
    const all = expandOccurrences(s, { from: madrid(2025, 1, 1), to: window.to }, 100_000);
    const expected = all.filter((o) => o.endAt > window.from && o.startAt < window.to);
    expect(jumped.map((o) => o.startAt.toISOString())).toEqual(
      expected.map((o) => o.startAt.toISOString()),
    );
    expect(jumped.length).toBeGreaterThan(0);
  });
});

describe('validateRecurrence y normalización', () => {
  const monday = madrid(2026, 9, 21, 10);
  const check = (rule: RecurrenceRule) => validateRecurrence(rule, monday, TZ);

  it('acepta reglas válidas', () => {
    expect(check({ freq: 'daily', interval: 1 })).toEqual([]);
    expect(check({ freq: 'weekly', interval: 2, byWeekday: [0, 3], count: 10 })).toEqual([]);
    expect(check({ freq: 'monthly', interval: 1, until: '2027-01-01' })).toEqual([]);
  });

  it.each([
    ['interval 0', { freq: 'daily', interval: 0 }, /interval/],
    ['interval demasiado grande', { freq: 'daily', interval: 100 }, /interval/],
    ['interval no entero', { freq: 'daily', interval: 1.5 }, /interval/],
    [
      'until y count a la vez',
      { freq: 'daily', interval: 1, until: '2027-01-01', count: 3 },
      /excluyentes/,
    ],
    ['count 0', { freq: 'daily', interval: 1, count: 0 }, /count/],
    ['count enorme', { freq: 'daily', interval: 1, count: 1000 }, /count/],
    ['until con formato incorrecto', { freq: 'daily', interval: 1, until: '01/01/2027' }, /until/],
    ['until inexistente', { freq: 'daily', interval: 1, until: '2027-02-30' }, /until/],
    ['until anterior al inicio', { freq: 'daily', interval: 1, until: '2026-09-20' }, /anterior/],
    ['byWeekday en diaria', { freq: 'daily', interval: 1, byWeekday: [0] }, /solo se admite/],
    ['byWeekday fuera de rango', { freq: 'weekly', interval: 1, byWeekday: [0, 7] }, /byWeekday/],
    ['byWeekday repetido', { freq: 'weekly', interval: 1, byWeekday: [0, 0] }, /byWeekday/],
    ['byWeekday sin el día del inicio', { freq: 'weekly', interval: 1, byWeekday: [2] }, /incluir/],
    [
      'frecuencia desconocida',
      { freq: 'yearly', interval: 1 } as unknown as RecurrenceRule,
      /freq/,
    ],
  ] as [string, RecurrenceRule, RegExp][])('rechaza %s', (_name, rule, message) => {
    expect(check(rule).join(' ')).toMatch(message);
  });

  it('weekly sin byWeekday se completa con el día del inicio', () => {
    expect(normalizeRecurrence({ freq: 'weekly', interval: 1 }, 2)).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekday: [2],
    });
    expect(
      normalizeRecurrence({ freq: 'weekly', interval: 1, byWeekday: [4, 0, 4] }, 0).byWeekday,
    ).toEqual([0, 4]);
  });

  it('weekdayIn usa la zona del evento (0 = lunes)', () => {
    expect(weekdayIn(monday, TZ)).toBe(0);
    // Lunes 00:30 en Madrid sigue siendo domingo en Nueva York.
    expect(weekdayIn(madrid(2026, 9, 21, 0, 30), 'America/New_York')).toBe(6);
  });
});

describe('recurrencia en el evento', () => {
  const base = {
    title: 'Entrenamiento',
    startAt: madrid(2026, 9, 21, 18),
    endAt: madrid(2026, 9, 21, 19),
    timezone: TZ,
  };

  it('normaliza la regla al crear: weekly sin días usa el del inicio', () => {
    const event = newEventFields({ ...base, recurrence: { freq: 'weekly', interval: 1 } });
    expect(event.recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [0] });
  });

  it('rechaza una regla inválida con el prefijo recurrence', () => {
    expect(() => newEventFields({ ...base, recurrence: { freq: 'daily', interval: 0 } })).toThrow(
      InvalidEventError,
    );
    expect(() =>
      newEventFields({ ...base, recurrence: { freq: 'weekly', interval: 1, byWeekday: [3] } }),
    ).toThrow(/recurrence/);
  });

  it('un evento sin repetición tiene recurrence null y categoryId null', () => {
    expect(newEventFields(base)).toMatchObject({ recurrence: null, categoryId: null });
  });

  it('hasChanges y describeChanges detectan cambios de regla y de categoría', () => {
    const a = {
      ...newEventFields({ ...base, recurrence: { freq: 'daily', interval: 1 } }),
      deleted: false,
    };
    const same = { ...a, recurrence: { freq: 'daily' as const, interval: 1 } };
    expect(hasChanges(a, same)).toBe(false);
    expect(describeChanges(a, same)).toEqual([]);

    const weekly = { ...a, recurrence: { freq: 'weekly' as const, interval: 1, byWeekday: [0] } };
    expect(hasChanges(a, weekly)).toBe(true);
    expect(describeChanges(a, weekly)).toEqual([
      { field: 'recurrence', from: a.recurrence, to: weekly.recurrence },
    ]);

    const categorized = { ...a, categoryId: '3f1c2a54-6a5e-4c4b-9f0e-0a4c8f0f6b11' };
    expect(hasChanges(a, categorized)).toBe(true);
    expect(describeChanges(a, categorized)).toEqual([
      { field: 'categoryId', from: null, to: '3f1c2a54-6a5e-4c4b-9f0e-0a4c8f0f6b11' },
    ]);
    const stopped = { ...a, recurrence: null };
    expect(describeChanges(a, stopped)).toEqual([
      { field: 'recurrence', from: a.recurrence, to: null },
    ]);
  });
});
