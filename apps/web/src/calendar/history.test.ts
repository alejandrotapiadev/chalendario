import { describe, expect, it } from 'vitest';
import { describeChange, describeReason } from './history.ts';

describe('describeChange', () => {
  it('describe cambios de texto entre comillas y con «vacío» para lo que no había', () => {
    expect(describeChange({ field: 'title', from: 'Gym', to: 'Gym 2' })).toBe(
      'Título: «Gym» → «Gym 2»',
    );
    expect(describeChange({ field: 'location', from: '', to: 'Sala 2' })).toBe(
      'Ubicación: vacío → «Sala 2»',
    );
  });

  it('trunca los textos largos', () => {
    const long = 'x'.repeat(100);
    const text = describeChange({ field: 'description', from: '', to: long });
    expect(text).toBe(`Descripción: vacío → «${'x'.repeat(60)}…»`);
  });

  it('formatea fechas en hora local y booleanos y estados en español', () => {
    const from = new Date(2026, 8, 21, 10, 0).toISOString();
    const to = new Date(2026, 8, 21, 11, 0).toISOString();
    expect(describeChange({ field: 'startAt', from, to })).toMatch(
      /^Inicio: 21 sept?\.?,? 10:00 → 21 sept?\.?,? 11:00$/,
    );
    expect(describeChange({ field: 'allDay', from: false, to: true })).toBe('Todo el día: no → sí');
    expect(describeChange({ field: 'status', from: 'confirmed', to: 'cancelled' })).toBe(
      'Estado: Confirmado → Cancelado',
    );
    expect(describeChange({ field: 'color', from: null, to: '#112233' })).toBe(
      'Color: vacío → #112233',
    );
  });

  it('el borrado y la recuperación tienen frase propia', () => {
    expect(describeChange({ field: 'deleted', from: false, to: true })).toBe('Evento eliminado');
    expect(describeChange({ field: 'deleted', from: true, to: false })).toBe('Evento restaurado');
  });
});

describe('describeReason', () => {
  it('traduce los motivos automáticos y respeta los del usuario', () => {
    expect(describeReason(null)).toBeNull();
    expect(describeReason('deleted')).toBeNull();
    expect(describeReason('restored from version 2')).toBe('Restaurada desde la versión 2');
    expect(describeReason('cambio de sala')).toBe('cambio de sala');
  });
});
