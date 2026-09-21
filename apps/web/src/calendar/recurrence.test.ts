import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPEAT_FORM,
  describeRule,
  formFromRule,
  ruleFromForm,
  type RepeatForm,
} from './recurrence.ts';

const form = (over: Partial<RepeatForm>): RepeatForm => ({ ...DEFAULT_REPEAT_FORM, ...over });

describe('ruleFromForm', () => {
  it('«no se repite» es null', () => {
    expect(ruleFromForm(form({}), 0)).toBeNull();
  });

  it('daily y monthly no llevan byWeekday', () => {
    expect(ruleFromForm(form({ repeat: 'daily', interval: 2, weekdays: [1, 2] }), 0)).toEqual({
      freq: 'daily',
      interval: 2,
    });
    expect(ruleFromForm(form({ repeat: 'monthly' }), 0)).toEqual({ freq: 'monthly', interval: 1 });
  });

  it('weekly incluye siempre el día del inicio, ordenado y sin repetir', () => {
    expect(ruleFromForm(form({ repeat: 'weekly', weekdays: [4, 2] }), 0)).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekday: [0, 2, 4],
    });
    expect(ruleFromForm(form({ repeat: 'weekly', weekdays: [2, 2] }), 2)?.byWeekday).toEqual([2]);
  });

  it('el fin depende del modo elegido', () => {
    const base = { repeat: 'daily' as const, until: '2026-12-03', count: 5 };
    expect(ruleFromForm(form({ ...base, endMode: 'never' }), 0)).toEqual({
      freq: 'daily',
      interval: 1,
    });
    expect(ruleFromForm(form({ ...base, endMode: 'until' }), 0)).toEqual({
      freq: 'daily',
      interval: 1,
      until: '2026-12-03',
    });
    expect(ruleFromForm(form({ ...base, endMode: 'count' }), 0)).toEqual({
      freq: 'daily',
      interval: 1,
      count: 5,
    });
  });

  it('until vacío se ignora y los números se sanean', () => {
    expect(ruleFromForm(form({ repeat: 'daily', endMode: 'until', until: '' }), 0)).toEqual({
      freq: 'daily',
      interval: 1,
    });
    expect(ruleFromForm(form({ repeat: 'daily', interval: 0 }), 0)?.interval).toBe(1);
    expect(ruleFromForm(form({ repeat: 'daily', interval: NaN }), 0)?.interval).toBe(1);
    expect(ruleFromForm(form({ repeat: 'daily', endMode: 'count', count: 0 }), 0)?.count).toBe(1);
  });
});

describe('formFromRule', () => {
  it('es el inverso de ruleFromForm', () => {
    const rules = [
      { freq: 'daily' as const, interval: 3 },
      { freq: 'weekly' as const, interval: 2, byWeekday: [0, 3], count: 8 },
      { freq: 'monthly' as const, interval: 1, until: '2027-01-31' },
    ];
    for (const rule of rules) {
      const weekday = rule.byWeekday?.[0] ?? 0;
      expect(ruleFromForm(formFromRule(rule), weekday)).toEqual(rule);
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
  });

  it('incluye los días de la semana en orden', () => {
    expect(describeRule({ freq: 'weekly', interval: 2, byWeekday: [0, 2, 4] })).toBe(
      'Cada 2 semanas (lun, mié, vie)',
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
