import type { RecurrenceFreq, RecurrenceRule } from '@calendar/domain';
import { LOCALE } from './dates.ts';

/** Días de la semana con lunes = 0, igual que en la regla (`byWeekday`). */
export const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const WEEKDAY_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const WEEKDAY_LONG = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
];

export type RepeatMode = 'none' | RecurrenceFreq;
export type RepeatEnd = 'never' | 'until' | 'count';

/** Estado del formulario de repetición (fechas como `YYYY-MM-DD` de un `<input type="date">`). */
export interface RepeatForm {
  repeat: RepeatMode;
  interval: number;
  /** Días marcados; el del inicio del evento se añade siempre al construir la regla. */
  weekdays: number[];
  endMode: RepeatEnd;
  until: string;
  count: number;
}

export const DEFAULT_REPEAT_FORM: RepeatForm = {
  repeat: 'none',
  interval: 1,
  weekdays: [],
  endMode: 'never',
  until: '',
  count: 10,
};

export function formFromRule(rule: RecurrenceRule | null): RepeatForm {
  if (!rule) return { ...DEFAULT_REPEAT_FORM };
  return {
    repeat: rule.freq,
    interval: rule.interval,
    weekdays: rule.byWeekday ?? [],
    endMode: rule.until !== undefined ? 'until' : rule.count !== undefined ? 'count' : 'never',
    until: rule.until ?? '',
    count: rule.count ?? DEFAULT_REPEAT_FORM.count,
  };
}

/** Regla a enviar a la API; `startWeekday` es el día de la semana (0 = lunes) del inicio. */
export function ruleFromForm(form: RepeatForm, startWeekday: number): RecurrenceRule | null {
  if (form.repeat === 'none') return null;
  const rule: RecurrenceRule = {
    freq: form.repeat,
    interval: Math.max(1, Math.floor(form.interval) || 1),
  };
  if (form.repeat === 'weekly') {
    rule.byWeekday = [...new Set([...form.weekdays, startWeekday])].sort((a, b) => a - b);
  }
  if (form.endMode === 'until' && form.until) rule.until = form.until;
  if (form.endMode === 'count') rule.count = Math.max(1, Math.floor(form.count) || 1);
  return rule;
}

const UNITS: Record<RecurrenceFreq, [singular: string, plural: string, every: string]> = {
  daily: ['día', 'días', 'Cada'],
  weekly: ['semana', 'semanas', 'Cada'],
  monthly: ['mes', 'meses', 'Cada'],
};

const shortDate = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatCivil(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return shortDate.format(new Date(y!, m! - 1, d!));
}

/** «Cada 2 semanas (lun, mié), hasta el 3 dic 2026». */
export function describeRule(rule: RecurrenceRule): string {
  const [singular, plural, every] = UNITS[rule.freq];
  let text = rule.interval === 1 ? `${every} ${singular}` : `${every} ${rule.interval} ${plural}`;
  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    text += ` (${rule.byWeekday.map((d) => WEEKDAY_SHORT[d]).join(', ')})`;
  }
  if (rule.until !== undefined) text += `, hasta el ${formatCivil(rule.until)}`;
  if (rule.count !== undefined) text += `, ${rule.count} ${rule.count === 1 ? 'vez' : 'veces'}`;
  return text;
}
