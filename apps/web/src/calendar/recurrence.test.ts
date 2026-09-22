import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPEAT_FORM,
  describeRule,
  formFromRule,
  ruleFromForm,
  type RepeatForm,
} from './recurrence.ts';

const form = (over: Partial<RepeatForm>): RepeatForm => ({ ...DEFAULT_REPEAT_FORM, ...over });

const TZ = 'Europe/Madrid';
// Semana del 21 (lunes) al 27 (domingo) sep 2026, sin cambio de hora dentro de ella.
const dateForWeekday = (weekday: number) => new Date(Date.UTC(2026, 8, 21 + weekday, 8, 0, 0));
const monday = dateForWeekday(0);
const wednesday = dateForWeekday(2);
// 21 sep 2026 es el 3er lunes del mes (no el último: el 28 también es lunes).
const monthlyMonday = form({ repeat: 'monthly', monthlyMode: 'bySetPos' });

describe('ruleFromForm', () => {
  it('«no se repite» es null', () => {
    expect(ruleFromForm(form({}), monday, TZ)).toBeNull();
  });

  it('daily y monthly (por día del mes) no llevan byWeekday ni bySetPos', () => {
    expect(
      ruleFromForm(form({ repeat: 'daily', interval: 2, weekdays: [1, 2] }), monday, TZ),
    ).toEqual({
      freq: 'daily',
      interval: 2,
    });
    expect(ruleFromForm(form({ repeat: 'monthly' }), monday, TZ)).toEqual({
      freq: 'monthly',
      interval: 1,
    });
  });

  it('weekly incluye siempre el día del inicio, ordenado y sin repetir', () => {
    expect(ruleFromForm(form({ repeat: 'weekly', weekdays: [4, 2] }), monday, TZ)).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekday: [0, 2, 4],
    });
    expect(
      ruleFromForm(form({ repeat: 'weekly', weekdays: [2, 2] }), wednesday, TZ)?.byWeekday,
    ).toEqual([2]);
  });

  it('monthly/yearly con modo «bySetPos» calculan la ocurrencia del inicio', () => {
    expect(ruleFromForm(monthlyMonday, monday, TZ)).toEqual({
      freq: 'monthly',
      interval: 1,
      bySetPos: 3,
    });
    expect(ruleFromForm(form({ repeat: 'yearly', monthlyMode: 'bySetPos' }), monday, TZ)).toEqual({
      freq: 'yearly',
      interval: 1,
      bySetPos: 3,
    });
  });

  it('el fin depende del modo elegido', () => {
    const base = { repeat: 'daily' as const, until: '2026-12-03', count: 5 };
    expect(ruleFromForm(form({ ...base, endMode: 'never' }), monday, TZ)).toEqual({
      freq: 'daily',
      interval: 1,
    });
    expect(ruleFromForm(form({ ...base, endMode: 'until' }), monday, TZ)).toEqual({
      freq: 'daily',
      interval: 1,
      until: '2026-12-03',
    });
    expect(ruleFromForm(form({ ...base, endMode: 'count' }), monday, TZ)).toEqual({
      freq: 'daily',
      interval: 1,
      count: 5,
    });
  });

  it('until vacío se ignora y los números se sanean', () => {
    expect(
      ruleFromForm(form({ repeat: 'daily', endMode: 'until', until: '' }), monday, TZ),
    ).toEqual({
      freq: 'daily',
      interval: 1,
    });
    expect(ruleFromForm(form({ repeat: 'daily', interval: 0 }), monday, TZ)?.interval).toBe(1);
    expect(ruleFromForm(form({ repeat: 'daily', interval: NaN }), monday, TZ)?.interval).toBe(1);
    expect(
      ruleFromForm(form({ repeat: 'daily', endMode: 'count', count: 0 }), monday, TZ)?.count,
    ).toBe(1);
  });
});

describe('formFromRule', () => {
  it('es el inverso de ruleFromForm', () => {
    const rules = [
      { freq: 'daily' as const, interval: 3 },
      { freq: 'weekly' as const, interval: 2, byWeekday: [0, 3], count: 8 },
      { freq: 'monthly' as const, interval: 1, until: '2027-01-31' },
      { freq: 'monthly' as const, interval: 1, bySetPos: 3 as const },
    ];
    for (const rule of rules) {
      const weekday = rule.byWeekday?.[0] ?? 0;
      expect(ruleFromForm(formFromRule(rule), dateForWeekday(weekday), TZ)).toEqual(rule);
    }
    expect(formFromRule(null)).toEqual(DEFAULT_REPEAT_FORM);
  });
});

describe('describeRule', () => {
  it('describe la frecuencia con singular y plural', () => {
    expect(describeRule({ freq: 'daily', interval: 1 })).toBe('Cada día');
    expect(describeRule({ freq: 'daily', interval: 3 })).toBe('Cada 3 días');
    expect(describeRule({ freq: 'weekly', interval: 1, byWeekday: [0] })).toBe('Cada semana (lun)');
    expect(describeRule({ freq: 'monthly', interval: 2 })).toBe('Cada 2 meses');
    expect(describeRule({ freq: 'yearly', interval: 1 })).toBe('Cada año');
  });

  it('incluye los días de la semana en orden', () => {
    expect(describeRule({ freq: 'weekly', interval: 2, byWeekday: [0, 2, 4] })).toBe(
      'Cada 2 semanas (lun, mié, vie)',
    );
  });

  it('describe bySetPos con o sin el día de la semana', () => {
    expect(describeRule({ freq: 'monthly', interval: 1, bySetPos: 2 })).toBe(
      'Cada mes (misma posición semanal que el inicio)',
    );
    expect(describeRule({ freq: 'monthly', interval: 1, bySetPos: 2 }, 1)).toBe(
      'Cada mes (segundo martes)',
    );
    expect(describeRule({ freq: 'yearly', interval: 1, bySetPos: -1 }, 4)).toBe(
      'Cada año (último viernes)',
    );
  });

  it('describe el fin', () => {
    expect(describeRule({ freq: 'daily', interval: 1, count: 1 })).toBe('Cada día, 1 vez');
    expect(describeRule({ freq: 'daily', interval: 1, count: 10 })).toBe('Cada día, 10 veces');
    expect(describeRule({ freq: 'daily', interval: 1, until: '2026-12-03' })).toMatch(
      /^Cada día, hasta el 3 dic\.? 2026$/,
    );
  });
});
