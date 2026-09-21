import { describe, expect, it } from 'vitest';
import { daysBetween } from './dates.ts';
import { moveSpan, resizeSpan, sameSpan, snapMinutes } from './drag.ts';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m);
const span = (start: Date, end: Date) => ({ start, end });

describe('snapMinutes', () => {
  it('redondea a cuartos de hora', () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-8)).toBe(-15);
    expect(snapMinutes(-7)).toBe(0);
    expect(Object.is(snapMinutes(-3), 0)).toBe(true);
  });
});

describe('moveSpan', () => {
  it('mueve por minutos conservando la duración', () => {
    const moved = moveSpan(span(at(21, 10), at(21, 11, 30)), false, 0, 45);
    expect(moved).toEqual(span(at(21, 10, 45), at(21, 12, 15)));
  });

  it('mueve por días y minutos a la vez, también hacia atrás y cruzando medianoche', () => {
    expect(moveSpan(span(at(21, 10), at(21, 11)), false, 2, -60)).toEqual(
      span(at(23, 9), at(23, 10)),
    );
    expect(moveSpan(span(at(21, 23), at(22, 0, 30)), false, 0, 60)).toEqual(
      span(at(22, 0), at(22, 1, 30)),
    );
  });

  it('un evento de todo el día se mueve por días y sigue a medianoche local', () => {
    const moved = moveSpan(span(at(21, 0), at(23, 0)), true, 3);
    expect(moved).toEqual(span(at(24, 0), at(26, 0)));
  });

  it('conserva la hora local al cruzar un cambio de hora (fin del horario de verano)', () => {
    // Semana del 25 oct 2026 (Europa). En otras zonas no hay cambio y sigue siendo válido.
    const start = new Date(2026, 9, 23, 10, 0);
    const moved = moveSpan(span(start, new Date(2026, 9, 23, 11, 0)), false, 3);
    expect(moved.start.getHours()).toBe(10);
    expect(moved.end.getTime() - moved.start.getTime()).toBe(3_600_000);
  });
});

describe('resizeSpan', () => {
  it('cambia solo el fin', () => {
    expect(resizeSpan(span(at(21, 10), at(21, 11)), 30)).toEqual(span(at(21, 10), at(21, 11, 30)));
    expect(resizeSpan(span(at(21, 10), at(21, 12)), -45)).toEqual(span(at(21, 10), at(21, 11, 15)));
  });

  it('no baja de 15 minutos de duración', () => {
    expect(resizeSpan(span(at(21, 10), at(21, 11)), -120)).toEqual(
      span(at(21, 10), at(21, 10, 15)),
    );
  });
});

describe('sameSpan y daysBetween', () => {
  it('compara por instante', () => {
    expect(sameSpan(span(at(21, 10), at(21, 11)), span(at(21, 10), at(21, 11)))).toBe(true);
    expect(sameSpan(span(at(21, 10), at(21, 11)), span(at(21, 10), at(21, 12)))).toBe(false);
  });

  it('cuenta días de calendario, con signo, aunque haya cambio de hora', () => {
    expect(daysBetween(new Date(2026, 8, 21), new Date(2026, 8, 24, 15))).toBe(3);
    expect(daysBetween(new Date(2026, 8, 24), new Date(2026, 8, 21))).toBe(-3);
    expect(daysBetween(new Date(2026, 9, 20), new Date(2026, 9, 30))).toBe(10); // cruza el 25 oct
    expect(daysBetween(new Date(2026, 8, 21, 23), new Date(2026, 8, 21, 1))).toBe(0);
  });
});
