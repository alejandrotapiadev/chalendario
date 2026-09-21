import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  fromInputs,
  monthGridDays,
  shiftCursor,
  startOfWeek,
  toDateInput,
  toTimeInput,
  viewTitle,
  visibleRange,
  weekDays,
} from './dates.ts';

const ymd = (d: Date) => toDateInput(d);

describe('semanas y meses', () => {
  it('la semana empieza en lunes', () => {
    // 21 sep 2026 es lunes; 27 sep 2026 es domingo.
    expect(ymd(startOfWeek(new Date(2026, 8, 21)))).toBe('2026-09-21');
    expect(ymd(startOfWeek(new Date(2026, 8, 27)))).toBe('2026-09-21');
    expect(ymd(startOfWeek(new Date(2026, 8, 23, 15, 30)))).toBe('2026-09-21');
    expect(weekDays(new Date(2026, 8, 24)).map(ymd)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  it('la cuadrícula del mes son 42 días, empezando en lunes y conteniendo todo el mes', () => {
    const days = monthGridDays(new Date(2026, 8, 15)); // septiembre 2026
    expect(days).toHaveLength(42);
    expect(days[0]!.getDay()).toBe(1);
    expect(ymd(days[0]!)).toBe('2026-08-31');
    expect(days.map(ymd)).toContain('2026-09-30');
  });

  it('un mes que empieza en lunes no añade una semana previa', () => {
    // junio 2026 empieza en lunes
    expect(ymd(monthGridDays(new Date(2026, 5, 10))[0]!)).toBe('2026-06-01');
  });

  it('addMonths limita el día al último del mes destino', () => {
    expect(ymd(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28');
    expect(ymd(addMonths(new Date(2028, 0, 31), 1))).toBe('2028-02-29');
    expect(ymd(addMonths(new Date(2026, 11, 15), 1))).toBe('2027-01-15');
    expect(ymd(addMonths(new Date(2026, 0, 15), -1))).toBe('2025-12-15');
  });

  it('addDays cruza el cambio de hora sin desplazar la hora local', () => {
    // El 25 oct 2026 en Europa acaba el horario de verano; en otros husos da igual: la
    // hora local no debe cambiar.
    const d = addDays(new Date(2026, 9, 24, 10, 0), 2);
    expect(ymd(d)).toBe('2026-10-26');
    expect(d.getHours()).toBe(10);
  });
});

describe('visibleRange', () => {
  const cursor = new Date(2026, 8, 23, 12);

  it('día: 24 h locales', () => {
    const { from, to } = visibleRange('day', cursor);
    expect([ymd(from), ymd(to)]).toEqual(['2026-09-23', '2026-09-24']);
  });

  it('semana: lunes a lunes siguiente', () => {
    const { from, to } = visibleRange('week', cursor);
    expect([ymd(from), ymd(to)]).toEqual(['2026-09-21', '2026-09-28']);
  });

  it('mes: 42 días desde el lunes de la primera semana', () => {
    const { from, to } = visibleRange('month', cursor);
    expect([ymd(from), ymd(to)]).toEqual(['2026-08-31', '2026-10-12']);
  });
});

describe('navegación', () => {
  const cursor = new Date(2026, 8, 23);

  it('avanza y retrocede según la vista', () => {
    expect(ymd(shiftCursor('day', cursor, 1))).toBe('2026-09-24');
    expect(ymd(shiftCursor('week', cursor, -1))).toBe('2026-09-16');
    expect(ymd(shiftCursor('month', cursor, 1))).toBe('2026-10-23');
  });
});

describe('formato', () => {
  it('títulos de vista en español', () => {
    const cursor = new Date(2026, 8, 23);
    expect(viewTitle('month', cursor)).toBe('Septiembre de 2026');
    expect(viewTitle('day', cursor)).toMatch(/^Miércoles, 23 de septiembre de 2026$/);
    expect(viewTitle('week', cursor)).toMatch(/^21 – 27 sept?\.? 2026$/);
  });

  it('convierte a y desde los valores de los inputs', () => {
    const d = fromInputs('2026-09-21', '08:05');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 8, 21, 8, 5,
    ]);
    expect(toDateInput(d)).toBe('2026-09-21');
    expect(toTimeInput(d)).toBe('08:05');
    expect(fromInputs('2026-09-21').getHours()).toBe(0);
  });
});
